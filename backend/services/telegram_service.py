"""
Telegram Servisi — Pyrogram ile Telegram islemleri.
Dosya yukleme, indirme, listeleme ve streaming.
"""
import io
import os
import re
import asyncio
import base64
import hashlib
import logging
from collections import OrderedDict
from datetime import datetime
from typing import Optional, AsyncGenerator
from pyrogram.types import Message
from config import get_settings
from models.schemas import FileItem
from services import crypto_service, cache_service, client_pool, disk_cache_service, tg_media

logger = logging.getLogger(__name__)

# Caption sablonu
CAPTION_PREFIX = "IGLO::v1"

UPLOAD_PROGRESS = {}

# Mesaj objelerini cache'le
_MSG_CACHE: dict = {}
STREAM_CHUNK_SIZE = 1024 * 1024  # 1MB

# ── In-memory Chunk LRU Cache (varsayilan 128MB) ─────────────────
# Telegram'dan indirilen ham (sifreli) chunk'lar burada tutulur.
# Browser moov-atom seek'i veya ayni pozisyona tekrar istek atinca
# Telegram'dan tekrar indirmek yerine buradan verilir.
_CHUNK_CACHE: OrderedDict = OrderedDict()  # (message_id, chunk_idx) -> bytes
_CHUNK_CACHE_BYTES: int = 0
MAX_CHUNK_CACHE_BYTES: int = int(os.environ.get("IGLO_MEM_CACHE_MB", "128")) * 1024 * 1024

def _cache_put(message_id: int, chunk_idx: int, data: bytes):
    global _CHUNK_CACHE_BYTES
    key = (message_id, chunk_idx)
    if key in _CHUNK_CACHE:
        _CHUNK_CACHE.move_to_end(key)
        return
    _CHUNK_CACHE[key] = data
    _CHUNK_CACHE_BYTES += len(data)
    _CHUNK_CACHE.move_to_end(key)
    # Evict oldest entries if over limit
    while _CHUNK_CACHE_BYTES > MAX_CHUNK_CACHE_BYTES and _CHUNK_CACHE:
        _, evicted = _CHUNK_CACHE.popitem(last=False)
        _CHUNK_CACHE_BYTES -= len(evicted)

def _cache_get(message_id: int, chunk_idx: int) -> Optional[bytes]:
    key = (message_id, chunk_idx)
    if key in _CHUNK_CACHE:
        _CHUNK_CACHE.move_to_end(key)  # Mark as recently used
        return _CHUNK_CACHE[key]
    return None


# -- Caption helpers --------------------------------------------------------

def _build_caption(file: FileItem) -> str:
    return (
        f"{CAPTION_PREFIX}\n"
        f"name: {file.name}\n"
        f"folder: {file.folder}\n"
        f"size: {file.size}\n"
        f"type: {file.mime_type}\n"
        f"date: {file.date.isoformat()}\n"
        f"encrypted: {str(file.encrypted).lower()}\n"
        f"checksum: {file.checksum or ''}"
    )


def _parse_caption(caption: str) -> Optional[FileItem]:
    """Caption'i ayristir ve FileItem dondur."""
    if not caption or not caption.startswith(CAPTION_PREFIX):
        return None
    try:
        def get(key: str) -> str:
            match = re.search(rf"^{key}: (.+)$", caption, re.MULTILINE)
            return match.group(1).strip() if match else ""

        return FileItem(
            message_id=0,
            name=get("name"),
            folder=get("folder") or "/",
            size=int(get("size") or 0),
            mime_type=get("type") or "application/octet-stream",
            date=datetime.fromisoformat(get("date")) if get("date") else datetime.utcnow(),
            encrypted=get("encrypted").lower() == "true",
            checksum=get("checksum") or None,
        )
    except Exception:
        return None


# -- Sync -------------------------------------------------------------------

async def sync_from_telegram(full_refresh: bool = False):
    """
    Telegram kanalindan dosyalari oku ve cache'i guncelle.
    full_refresh=True ise tum gecmisi yeniden tara.
    """
    client = await client_pool.get_download_client()
    settings = get_settings()

    channel_id = settings.telegram_channel_id
    new_files = []

    try:
        async for message in client.search_messages(channel_id, query=CAPTION_PREFIX):
            if not message.caption:
                continue

            file_item = _parse_caption(message.caption)
            if file_item is None:
                continue

            file_item.message_id = message.id
            new_files.append(file_item)
    except Exception as e:
        print(f"Sync error during search: {e}")

    if full_refresh:
        cache_service.clear_cache()

    for file_item in new_files:
        cache_service.add_file(file_item)

    if new_files:
        cache_service.set_last_message_id(new_files[0].message_id)

    return new_files


# -- Upload -----------------------------------------------------------------

async def upload_file(
    file_data: bytes,
    filename: str,
    mime_type: str,
    folder: str = "/",
    upload_id: str = None
) -> FileItem:
    """Dosyayi sifrele ve Telegram'a yukle."""
    client = await client_pool.get_upload_client()
    settings = get_settings()

    encrypted_data = crypto_service.encrypt_bytes(file_data)
    nonce = encrypted_data[:16]
    nonce_b64 = base64.b64encode(nonce).decode("utf-8")
    checksum = f"aes-ctr:{nonce_b64}:" + hashlib.sha256(file_data).hexdigest()

    encrypted_stream = io.BytesIO(encrypted_data)
    encrypted_stream.name = filename + ".enc"

    temp_file = FileItem(
        message_id=0,
        name=filename,
        folder=folder,
        size=len(file_data),
        mime_type=mime_type,
        date=datetime.utcnow(),
        encrypted=True,
        checksum=checksum,
    )

    caption = _build_caption(temp_file)

    async def progress(current, total):
        if upload_id and total > 0:
            UPLOAD_PROGRESS[upload_id] = int((current / total) * 100)

    message: Message = await client.send_document(
        chat_id=settings.telegram_channel_id,
        document=encrypted_stream,
        caption=caption,
        file_name=filename + ".enc",
        force_document=True,
        progress=progress,
    )

    temp_file.message_id = message.id
    cache_service.add_file(temp_file)
    if upload_id in UPLOAD_PROGRESS:
        del UPLOAD_PROGRESS[upload_id]

    return temp_file


# -- Download ---------------------------------------------------------------

async def download_file_bytes(message_id: int) -> bytes:
    """Dosyayi Telegram'dan indir ve sifresini coz (kucuk dosyalar icin; buyuklerde stream kullan)."""
    file_item = cache_service.get_file(message_id)
    if not file_item:
        return b""
    out = bytearray()
    async for part in stream_file_chunks(message_id, 0, max(file_item.size - 1, 0)):
        out += part
    return bytes(out)


# -- Streaming --------------------------------------------------------------
#
# Tasarim:
#   * Telegram'dan 1MB'lik chunk'lar (sifreli haliyle) PARALEL olarak, kalici
#     MTProto oturumlari uzerinden indirilir (bkz. tg_media.py).
#   * Her chunk once RAM LRU'ya, sonra diske (disk_cache_service) yazilir; ayni
#     yeri tekrar izlemek / geri sarmak Telegram'a hic gitmez.
#   * Bir istek (Range) icin READAHEAD kadar chunk onceden istenir; tuketici
#     (tarayici) okudukca pencere ilerler. Boylece indirme hizi oynatma hizindan
#     hep onde kalir ve seek'lerde bile ilk bayt bir chunk gecikmesiyle gelir.
#   * Ayni chunk icin es-zamanli istekler tek indirmede birlesir (dedupe).
#   * Tarayici istegi iptal edince (seek) henuz baslamamis indirmeler iptal edilir,
#     boylece eski konumun read-ahead'i yeni konumun onune gecmez.

READAHEAD = max(1, int(os.environ.get("IGLO_READAHEAD_CHUNKS", "8")))


class _Fetch:
    """Bir chunk icin devam eden yukleme (RAM -> disk -> Telegram)."""
    __slots__ = ("task", "started", "refs", "value")

    def __init__(self):
        self.task: Optional[asyncio.Task] = None
        self.started = False
        self.refs = 0
        self.value: Optional[bytes] = None


_INFLIGHT: dict[tuple[int, int], _Fetch] = {}


async def _load_chunk(message_id: int, idx: int, expected: int, fetch: _Fetch) -> bytes:
    data = await disk_cache_service.read_chunk(message_id, idx, expected)
    if data is not None:
        _cache_put(message_id, idx, data)
        return data

    def _mark_started():
        fetch.started = True

    data = await tg_media.fetch_chunk(message_id, idx, on_start=_mark_started)
    _cache_put(message_id, idx, data)
    # Diske yazma oynatmayi geciktirmesin
    asyncio.create_task(_safe_disk_write(message_id, idx, data))
    return data


async def _safe_disk_write(message_id: int, idx: int, data: bytes):
    try:
        await disk_cache_service.write_chunk(message_id, idx, data)
    except Exception as e:  # noqa: BLE001
        logger.debug("disk cache write failed: %s", e)


def _request_chunk(message_id: int, idx: int, enc_size: int) -> _Fetch:
    """Chunk'i iste (RAM'de varsa aninda, yoksa/yuklemedeyse birlestirerek)."""
    cached = _cache_get(message_id, idx)
    if cached is not None:
        f = _Fetch()
        f.value = cached
        return f

    key = (message_id, idx)
    f = _INFLIGHT.get(key)
    if f is None:
        f = _Fetch()
        expected = tg_media.expected_len(enc_size, idx)
        f.task = asyncio.create_task(_load_chunk(message_id, idx, expected, f))
        _INFLIGHT[key] = f

        def _done(t: asyncio.Task, key=key, f=f):
            if _INFLIGHT.get(key) is f:
                _INFLIGHT.pop(key, None)
            if not t.cancelled():
                t.exception()  # "never retrieved" uyarisini onle

        f.task.add_done_callback(_done)
    f.refs += 1
    return f


def _release_chunk(f: _Fetch):
    if f.task is None:
        return
    f.refs -= 1
    if f.refs <= 0 and not f.started and not f.task.done():
        f.task.cancel()


async def _await_chunk(f: _Fetch) -> bytes:
    if f.value is not None:
        return f.value
    # shield: tuketici iptal olsa bile baslamis indirme cache'e dusmeye devam eder
    return await asyncio.shield(f.task)


async def _get_nonce(file_item: FileItem, message_id: int, enc_size: int) -> bytes:
    cs = file_item.checksum or ""
    if cs.startswith("aes-ctr:"):
        try:
            nonce = base64.b64decode(cs.split(":")[1])
            if len(nonce) == 16:
                return nonce
        except Exception:
            pass

    # Checksum'da nonce yok: ilk chunk'in basindan oku ve kalici kaydet
    f = _request_chunk(message_id, 0, enc_size)
    try:
        chunk0 = await _await_chunk(f)
    finally:
        _release_chunk(f)
    nonce = chunk0[:16] if chunk0 else b""
    if len(nonce) == 16:
        nonce_b64 = base64.b64encode(nonce).decode()
        file_item.checksum = f"aes-ctr:{nonce_b64}:" + (file_item.checksum or "")
        try:
            cache_service.add_file(file_item)
        except Exception:  # noqa: BLE001
            pass
    return nonce


async def prefetch_ends_to_chunk_cache(message_id: int):
    """
    Oynatici acilirken cagrilir (beklenmez, arka planda calisir).
    MP4'lerde moov atom cogu zaman dosyanin sonundadir; ilk 2 ve son 1 chunk'i
    onceden isteyerek tarayicinin ilk istekleri aninda karsilanir.
    """
    file_item = cache_service.get_file(message_id)
    if not file_item or file_item.size <= 0:
        return
    enc_size = file_item.size + (16 if file_item.encrypted else 0)
    total = max(1, (enc_size + STREAM_CHUNK_SIZE - 1) // STREAM_CHUNK_SIZE)
    wanted = sorted({0, min(1, total - 1), total - 1})

    fetches = [_request_chunk(message_id, c, enc_size) for c in wanted]
    try:
        for f in fetches:
            try:
                await _await_chunk(f)
            except Exception as e:  # noqa: BLE001
                logger.debug("[prefetch] msg=%s: %s", message_id, e)
    finally:
        for f in fetches:
            _release_chunk(f)


async def stream_file_chunks(
    message_id: int,
    start: int = 0,
    end: Optional[int] = None,
) -> AsyncGenerator[bytes, None]:
    """
    Duz metin dosyanin [start, end] (dahil) araligini uretir.
    Sifreli dosyalarda AES-CTR ile chunk bazinda cozulur (seek icin hizalamali).
    """
    file_item = cache_service.get_file(message_id)
    if not file_item or file_item.size <= 0:
        return

    plain_size = file_item.size
    if end is None or end >= plain_size:
        end = plain_size - 1
    if start < 0 or start > end:
        return

    encrypted = bool(file_item.encrypted)
    shift = 16 if encrypted else 0           # ilk 16 bayt = nonce
    enc_size = plain_size + shift            # Telegram'daki gercek dosya boyutu

    discard = 0
    decryptor = None
    if encrypted:
        nonce = await _get_nonce(file_item, message_id, enc_size)
        if len(nonce) < 16:
            logger.error("[stream] nonce bulunamadi msg_id=%s", message_id)
            return
        aligned = start - (start % 16)
        discard = start - aligned
        decryptor, _ = crypto_service.get_seekable_decryptor(nonce, aligned)
        first_byte = aligned + shift
    else:
        first_byte = start
    last_byte = end + shift

    first_chunk = first_byte // STREAM_CHUNK_SIZE
    last_chunk = last_byte // STREAM_CHUNK_SIZE

    pending: dict[int, _Fetch] = {}
    next_idx = first_chunk
    try:
        for ci in range(first_chunk, last_chunk + 1):
            limit = min(last_chunk, ci + READAHEAD - 1)
            while next_idx <= limit:
                pending[next_idx] = _request_chunk(message_id, next_idx, enc_size)
                next_idx += 1

            f = pending.pop(ci)
            try:
                chunk = await _await_chunk(f)
            finally:
                _release_chunk(f)

            chunk_start = ci * STREAM_CHUNK_SIZE
            s = first_byte - chunk_start if ci == first_chunk else 0
            e = min(len(chunk), last_byte - chunk_start + 1) if ci == last_chunk else len(chunk)
            if s >= e:
                continue
            piece = chunk if (s == 0 and e == len(chunk)) else chunk[s:e]

            if decryptor is not None:
                piece = decryptor.update(piece)
                if discard:
                    d = min(discard, len(piece))
                    piece = piece[d:]
                    discard -= d
            if piece:
                yield piece
    finally:
        for f in pending.values():
            _release_chunk(f)


# -- Delete -----------------------------------------------------------------

async def delete_file(message_id: int):
    """Dosyayi Telegram'dan sil."""
    client = await client_pool.get_upload_client()
    settings = get_settings()

    await client.delete_messages(settings.telegram_channel_id, message_id)
    cache_service.remove_file(message_id)
    disk_cache_service.remove(message_id)
    _MSG_CACHE.pop(message_id, None)
    tg_media.forget(message_id)


# -- Migration --------------------------------------------------------------

async def migrate_to_new_channel(
    new_channel_id: int,
    new_session_string: Optional[str] = None,
    progress_callback=None,
):
    """
    Tum dosyalari yeni bir Telegram kanalina tasi.
    Dosyalar zaten sifreli oldugu icin yeniden sifreleme gerekmez.
    """
    from pyrogram import Client
    source_client = await client_pool.get_download_client()
    settings = get_settings()

    if new_session_string:
        target_client = Client(
            name="iglo_target",
            api_id=settings.telegram_api_id,
            api_hash=settings.telegram_api_hash,
            session_string=new_session_string,
            in_memory=True,
        )
        await target_client.start()
    else:
        target_client = source_client

    files = cache_service.get_all_files()
    total = len(files)
    new_cache = {}

    for idx, file_item in enumerate(files):
        if progress_callback:
            await progress_callback(idx, total, file_item.name)

        msg_obj = await source_client.get_messages(
            settings.telegram_channel_id, file_item.message_id
        )
        res = await source_client.download_media(msg_obj, in_memory=True)
        encrypted_data = res.getvalue() if res else b""

        caption = _build_caption(file_item)
        buf2 = io.BytesIO(encrypted_data)
        buf2.name = file_item.name + ".enc"

        new_msg = await target_client.send_document(
            chat_id=new_channel_id,
            document=buf2,
            caption=caption,
            file_name=file_item.name + ".enc",
            force_document=True,
        )

        new_item = file_item.model_copy(update={"message_id": new_msg.id})
        new_cache[str(new_msg.id)] = new_item

    cache_service.clear_cache()
    for item in new_cache.values():
        cache_service.add_file(item)

    if new_session_string:
        await target_client.stop()
