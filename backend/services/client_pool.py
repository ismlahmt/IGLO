import os
from pyrogram import Client
from config import get_settings

_download_client = None
_upload_client = None
_cache_client = None

async def _resolve_channel_peer(client, channel_id):
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

async def get_download_client():
    global _download_client
    if _download_client is None:
        settings = get_settings()
        kwargs = {
            "name": "iglo_download",
            "api_id": settings.telegram_api_id,
            "api_hash": settings.telegram_api_hash,
            "ipv6": False
        }
        if settings.telegram_session_string:
            kwargs["session_string"] = settings.telegram_session_string
        
        _download_client = Client(**kwargs)
        await _download_client.start()
        
        # Resolve peer on first start if channel_id is available
        if hasattr(settings, 'telegram_channel_id') and settings.telegram_channel_id:
            await _resolve_channel_peer(_download_client, settings.telegram_channel_id)
            
    return _download_client

async def get_upload_client():
    global _upload_client
    if _upload_client is None:
        settings = get_settings()
        kwargs = {
            "name": "iglo_upload",
            "api_id": settings.telegram_api_id,
            "api_hash": settings.telegram_api_hash,
            "ipv6": False
        }
        if settings.telegram_session_string:
            kwargs["session_string"] = settings.telegram_session_string
            
        _upload_client = Client(**kwargs)
        await _upload_client.start()
        
        # Resolve peer on first start if channel_id is available
        if hasattr(settings, 'telegram_channel_id') and settings.telegram_channel_id:
            await _resolve_channel_peer(_upload_client, settings.telegram_channel_id)
            
    return _upload_client

async def get_cache_client():
    global _cache_client
    if _cache_client is None:
        settings = get_settings()
        kwargs = {
            "name": "iglo_cache",
            "api_id": settings.telegram_api_id,
            "api_hash": settings.telegram_api_hash,
            "ipv6": False
        }
        if settings.telegram_session_string:
            kwargs["session_string"] = settings.telegram_session_string
            
        _cache_client = Client(**kwargs)
        await _cache_client.start()
        
        # Resolve peer on first start if channel_id is available
        if hasattr(settings, 'telegram_channel_id') and settings.telegram_channel_id:
            await _resolve_channel_peer(_cache_client, settings.telegram_channel_id)
            
    return _cache_client

async def shutdown_all():
    global _download_client, _upload_client, _cache_client
    if _download_client is not None:
        await _download_client.stop()
        _download_client = None
    if _upload_client is not None:
        await _upload_client.stop()
        _upload_client = None
    if _cache_client is not None:
        await _cache_client.stop()
        _cache_client = None
