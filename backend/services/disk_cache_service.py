"""
Disk chunk cache.

Her video icin `<CACHE_DIR>/<message_id>/<chunk_idx>` seklinde 1MB'lik, Telegram'dan
geldigi haliyle (SIFRELI) chunk dosyalari tutulur. Boylece:
  - Sunucu diskinde duz metin video bulunmaz (sifreleme korunur),
  - Dosyanin ortasina/sonuna atlayinca bile sadece gereken chunk'lar iner,
    "sparse file" / Windows sifir-doldurma sorunu yoktur,
  - Yazma atomiktir (tmp + rename), yarim chunk asla okunmaz,
  - Bir kez izlenen kisimlar bir daha Telegram'a gitmeden diskten gelir.

Eski surumun tam (duz metin) `<id>.dat` dosyalari varsa onlar da hala servis edilir.
"""
import asyncio
import os
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional


def _default_cache_dir() -> str:
    env = os.environ.get("IGLO_CACHE_DIR")
    if env:
        return env
    if os.name == "posix":
        return "/var/cache/iglo"
    return str(Path(__file__).resolve().parent.parent / "media_cache")


CACHE_DIR = _default_cache_dir()
MAX_CACHE_GB = int(os.environ.get("IGLO_MAX_CACHE_GB", "150"))
MAX_CACHE_BYTES = MAX_CACHE_GB * 1024 * 1024 * 1024

try:
    os.makedirs(CACHE_DIR, exist_ok=True)
except OSError:
    # /var/cache/iglo yazilamiyorsa proje altina dus
    CACHE_DIR = str(Path(__file__).resolve().parent.parent / "media_cache")
    os.makedirs(CACHE_DIR, exist_ok=True)

# Disk I/O event loop'u bloklamasin diye ayri thread havuzu
_io_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="iglo-io")

_lock = threading.Lock()
# ("dir" | "dat", message_id) -> [size_bytes, last_access]
_entries: dict[tuple[str, int], list] = {}
_total_bytes = 0
_last_evict = 0.0


# ── Yol yardimcilari ─────────────────────────────────────────────────────────

def _dir_path(message_id: int) -> str:
    return os.path.join(CACHE_DIR, str(message_id))


def _chunk_path(message_id: int, idx: int) -> str:
    return os.path.join(CACHE_DIR, str(message_id), str(idx))


def get_path(message_id: int) -> str:
    """Eski tam-dosya (duz metin) cache yolu."""
    return os.path.join(CACHE_DIR, f"{message_id}.dat")


def is_cached(message_id: int) -> bool:
    """Eski surumden kalan, tamamen inmis duz metin dosya var mi?"""
    return os.path.exists(get_path(message_id))


def touch(message_id: int):
    now = time.time()
    with _lock:
        for kind in ("dir", "dat"):
            e = _entries.get((kind, message_id))
            if e:
                e[1] = now


# ── Chunk okuma / yazma ──────────────────────────────────────────────────────

def _read_chunk_sync(message_id: int, idx: int, expected: int) -> Optional[bytes]:
    try:
        with open(_chunk_path(message_id, idx), "rb") as f:
            data = f.read()
    except OSError:
        return None
    if expected and len(data) != expected:
        return None
    return data


def _write_chunk_sync(message_id: int, idx: int, data: bytes):
    global _total_bytes
    d = _dir_path(message_id)
    path = _chunk_path(message_id, idx)
    tmp = f"{path}.{threading.get_ident()}.tmp"
    try:
        os.makedirs(d, exist_ok=True)
        with open(tmp, "wb") as f:
            f.write(data)
        replaced = os.path.exists(path)
        os.replace(tmp, path)
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass
        return  # cache yazilamazsa sessizce gec; oynatma etkilenmesin

    with _lock:
        e = _entries.setdefault(("dir", message_id), [0, time.time()])
        if not replaced:
            e[0] += len(data)
            _total_bytes += len(data)
        e[1] = time.time()

    _maybe_evict_sync()


async def read_chunk(message_id: int, idx: int, expected: int = 0) -> Optional[bytes]:
    loop = asyncio.get_running_loop()
    data = await loop.run_in_executor(_io_pool, _read_chunk_sync, message_id, idx, expected)
    if data is not None:
        touch(message_id)
    return data


async def write_chunk(message_id: int, idx: int, data: bytes):
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(_io_pool, _write_chunk_sync, message_id, idx, data)


# ── Silme / tahliye ──────────────────────────────────────────────────────────

def remove(message_id: int):
    """Dosya silinince tum cache'ini kaldir."""
    global _total_bytes
    shutil.rmtree(_dir_path(message_id), ignore_errors=True)
    try:
        os.remove(get_path(message_id))
    except OSError:
        pass
    with _lock:
        for kind in ("dir", "dat"):
            e = _entries.pop((kind, message_id), None)
            if e:
                _total_bytes -= e[0]


def get_cache_size_bytes() -> int:
    return _total_bytes


def _maybe_evict_sync():
    """Limit asilirsa en az kullanilan videolari (LRU) sil. En fazla 15 sn'de bir calisir."""
    global _total_bytes, _last_evict
    if _total_bytes <= MAX_CACHE_BYTES:
        return
    now = time.time()
    if now - _last_evict < 15:
        return
    _last_evict = now

    target = int(MAX_CACHE_BYTES * 0.9)
    with _lock:
        order = sorted(_entries.items(), key=lambda kv: kv[1][1])

    for (kind, mid), (size, _) in order:
        if _total_bytes <= target:
            break
        if kind == "dir":
            shutil.rmtree(_dir_path(mid), ignore_errors=True)
        else:
            try:
                os.remove(get_path(mid))
            except OSError:
                pass
        with _lock:
            e = _entries.pop((kind, mid), None)
            if e:
                _total_bytes -= e[0]


def init_cache():
    """Acilista mevcut cache'i tara (boyut + son erisim zamani)."""
    global _total_bytes
    total = 0
    try:
        with os.scandir(CACHE_DIR) as it:
            for ent in it:
                try:
                    if ent.is_dir() and ent.name.isdigit():
                        size = 0
                        with os.scandir(ent.path) as sub:
                            for c in sub:
                                if c.name.endswith(".tmp"):
                                    try:
                                        os.remove(c.path)
                                    except OSError:
                                        pass
                                    continue
                                size += c.stat().st_size
                        _entries[("dir", int(ent.name))] = [size, ent.stat().st_mtime]
                        total += size
                    elif ent.is_file() and ent.name.endswith(".dat"):
                        mid = int(ent.name[:-4])
                        st = ent.stat()
                        _entries[("dat", mid)] = [st.st_size, st.st_atime]
                        total += st.st_size
                    elif ent.is_file() and ent.name.endswith(".tmp"):
                        os.remove(ent.path)
                except (OSError, ValueError):
                    continue
    except OSError:
        pass
    _total_bytes = total


init_cache()
