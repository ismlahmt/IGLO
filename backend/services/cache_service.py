"""
Cache Servisi — Dosya metadata'sını JSON olarak saklar.
Telegram'ı her açılışta taramak yerine sadece delta güncelleme yapar.
"""
import json
import os
import threading
from datetime import datetime
from typing import Optional
from models.schemas import FileItem, CacheStats

CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "cache.json")

# ── In-memory cache ──────────────────────────────────────────────────────────
# cache.json'u sadece ilk erişimde diskten oku, sonrasında bellekte tut.
# Önceden her stream/chunk isteğinde dosya diskten okunup JSON parse ediliyordu
# (event loop'u bloklayan senkron I/O) — video oynatırken saniyede onlarca kez
# tetiklenen bu okuma, gereksiz gecikme ve donmalara katkı sağlıyordu.
_cache: Optional[dict] = None
_lock = threading.Lock()


def _load_raw() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    with _lock:
        if _cache is not None:
            return _cache
        if not os.path.exists(CACHE_FILE):
            _cache = {"files": {}, "last_message_id": 0, "last_updated": None}
        else:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                _cache = json.load(f)
    return _cache


def _save_raw(data: dict):
    global _cache
    _cache = data
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


def get_all_files() -> list[FileItem]:
    """Cache'deki tüm dosyaları döndür."""
    raw = _load_raw()
    files = []
    for msg_id, item in raw.get("files", {}).items():
        try:
            files.append(FileItem(**item))
        except Exception:
            pass
    return sorted(files, key=lambda f: f.date, reverse=True)


def get_file(message_id: int) -> Optional[FileItem]:
    """Belirli bir dosyayı döndür."""
    raw = _load_raw()
    item = raw.get("files", {}).get(str(message_id))
    if item:
        return FileItem(**item)
    return None


def add_file(file: FileItem):
    """Cache'e dosya ekle."""
    raw = _load_raw()
    raw["files"][str(file.message_id)] = file.model_dump()
    raw["last_message_id"] = max(raw.get("last_message_id", 0), file.message_id)
    raw["last_updated"] = datetime.utcnow().isoformat()
    _save_raw(raw)


def remove_file(message_id: int):
    """Cache'den dosyayı kaldır."""
    raw = _load_raw()
    raw["files"].pop(str(message_id), None)
    raw["last_updated"] = datetime.utcnow().isoformat()
    _save_raw(raw)


def get_last_message_id() -> int:
    """Son işlenen mesaj ID'sini döndür (delta güncelleme için)."""
    return _load_raw().get("last_message_id", 0)


def set_last_message_id(msg_id: int):
    raw = _load_raw()
    raw["last_message_id"] = msg_id
    _save_raw(raw)


def get_stats() -> CacheStats:
    raw = _load_raw()
    files = list(raw.get("files", {}).values())
    total_size = sum(f.get("size", 0) for f in files)
    last_updated = raw.get("last_updated")
    return CacheStats(
        total_files=len(files),
        total_size=total_size,
        last_updated=datetime.fromisoformat(last_updated) if last_updated else None,
        last_message_id=raw.get("last_message_id", 0),
    )


def clear_cache():
    """Cache'i tamamen sil (yeniden tarama için)."""
    _save_raw({"files": {}, "last_message_id": 0, "last_updated": None})

