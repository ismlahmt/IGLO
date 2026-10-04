"""
Client Pool — Pyrogram bağlantı yönetimi.
AUTH_KEY_DUPLICATED hatasını önlemek için tek bir paylaşımlı client kullanılır.
Aynı session string'in birden fazla client'ta kullanılması Telegram tarafından
aynı auth key'in paralel kullanımı olarak değerlendirilir ve bloke edilir.
"""
import os
import asyncio
from pyrogram import Client
from config import get_settings

# Tek paylaşımlı client — upload, download ve cache için aynısı kullanılır
_shared_client: Client | None = None
_client_lock: asyncio.Lock | None = None


async def _resolve_channel_peer(client: Client, channel_id: int):
    """Kanalı peer listesine ekle (ilk bağlantıda gerekli)."""
    try:
        async for dialog in client.get_dialogs():
            if dialog.chat.id == channel_id:
                return
    except Exception:
        pass
    try:
        await client.resolve_peer(channel_id)
    except Exception:
        pass


async def _get_client() -> Client:
    """Tek paylaşımlı Pyrogram client'ını başlat ve döndür."""
    global _shared_client, _client_lock
    if _shared_client is not None and _shared_client.is_connected:
        return _shared_client

    if _client_lock is None:
        _client_lock = asyncio.Lock()

    async with _client_lock:
        # Kilidi beklerken baska bir istek client'i baslatmis olabilir
        if _shared_client is not None and _shared_client.is_connected:
            return _shared_client

        settings = get_settings()
        kwargs = {
            "name": "iglo",
            "api_id": settings.telegram_api_id,
            "api_hash": settings.telegram_api_hash,
            "ipv6": False,
        }

        if settings.telegram_session_string:
            kwargs["session_string"] = settings.telegram_session_string
            kwargs["in_memory"] = True  # Disk'e .session dosyası yazma

        client = Client(**kwargs)
        await client.start()

        if settings.telegram_channel_id:
            await _resolve_channel_peer(client, settings.telegram_channel_id)

        _shared_client = client
        return _shared_client


# Eski arayüz — geriye dönük uyumluluk için aynı isimler korundu
async def get_download_client() -> Client:
    return await _get_client()


async def get_upload_client() -> Client:
    return await _get_client()


async def get_cache_client() -> Client:
    return await _get_client()


async def shutdown_all():
    global _shared_client
    if _shared_client is not None:
        try:
            await _shared_client.stop()
        except Exception:
            pass
        _shared_client = None
