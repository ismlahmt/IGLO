"""
Telegram Servisi — Pyrogram ile Telegram işlemleri.
Dosya yükleme, indirme, listeleme ve streaming.
"""
import io
import re
import asyncio
from datetime import datetime
from typing import Optional, AsyncGenerator
from pyrogram import Client
from pyrogram.types import Message
from config import get_settings
from models.schemas import FileItem
from services import crypto_service, cache_service

# Caption şablonu — Telegram mesajına yazılacak format
CAPTION_PREFIX = "IGLO::v1"

_client: Optional[Client] = None


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
    """Caption'ı ayrıştır ve FileItem döndür."""
    if not caption or not caption.startswith(CAPTION_PREFIX):
        return None
    try:
        def get(key: str) -> str:
            match = re.search(rf"^{key}: (.+)$", caption, re.MULTILINE)
            return match.group(1).strip() if match else ""

        return FileItem(
            message_id=0,  # Caller tarafından doldurulacak
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


async def get_client() -> Client:
    """Pyrogram client'ını başlat veya mevcut olanı döndür."""
    global _client
    settings = get_settings()

    if _client is None or not _client.is_connected:
        if settings.telegram_session_string:
            _client = Client(
                name="iglo",
                api_id=settings.telegram_api_id,
                api_hash=settings.telegram_api_hash,
                session_string=settings.telegram_session_string,
                in_memory=True,
            )
        else:
            _client = Client(
                name="iglo_session",
                api_id=settings.telegram_api_id,
                api_hash=settings.telegram_api_hash,
                workdir=".",
            )
        await _client.start()

    return _client


async def shutdown_client():
    """Uygulama kapanırken client'ı durdur."""
    global _client
    if _client and _client.is_connected:
        await _client.stop()
    _client = None


async def sync_from_telegram(full_refresh: bool = False):
    """
    Telegram kanalından dosyaları oku ve cache'i güncelle.
    full_refresh=True ise tüm geçmişi yeniden tara.
    """
    client = await get_client()
    settings = get_settings()

    if full_refresh:
        cache_service.clear_cache()

    last_id = 0 if full_refresh else cache_service.get_last_message_id()
    channel_id = settings.telegram_channel_id
    new_files = []

    async for message in client.get_chat_history(channel_id):
        if message.id <= last_id:
            break
        if not message.caption:
            continue

        file_item = _parse_caption(message.caption)
        if file_item is None:
            continue

        file_item.message_id = message.id
        cache_service.add_file(file_item)
        new_files.append(file_item)

    if new_files:
        cache_service.set_last_message_id(new_files[0].message_id)

    return new_files


async def upload_file(
    file_data: bytes,
    filename: str,
    mime_type: str,
    folder: str = "/",
) -> FileItem:
    """Dosyayı şifrele ve Telegram'a yükle."""
    import hashlib

    client = await get_client()
    settings = get_settings()

    # Checksum (orijinal veriden)
    checksum = "sha256:" + hashlib.sha256(file_data).hexdigest()

    # Şifrele
    encrypted_data = crypto_service.encrypt_bytes(file_data)
    encrypted_stream = io.BytesIO(encrypted_data)
    encrypted_stream.name = filename + ".enc"

    # Geçici FileItem (caption için)
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

    # Telegram'a yükle
    message: Message = await client.send_document(
        chat_id=settings.telegram_channel_id,
        document=encrypted_stream,
        caption=caption,
        file_name=filename + ".enc",
        force_document=True,
    )

    temp_file.message_id = message.id
    cache_service.add_file(temp_file)
    return temp_file


async def download_file_bytes(message_id: int) -> bytes:
    """Dosyayı Telegram'dan indir ve şifresini çöz."""
    client = await get_client()
    settings = get_settings()

    file_item = cache_service.get_file(message_id)

    buf = io.BytesIO()
    await client.download_media(
        message=await client.get_messages(settings.telegram_channel_id, message_id),
        file_name=buf,
        in_memory=True,
    )
    buf.seek(0)
    data = buf.read()

    if file_item and file_item.encrypted:
        data = crypto_service.decrypt_bytes(data)

    return data


async def stream_file_chunks(
    message_id: int,
    start: int = 0,
    end: Optional[int] = None,
) -> AsyncGenerator[bytes, None]:
    """
    Video/audio streaming için chunk bazında veri döndür.
    Önce tüm şifreli dosyayı indir, çöz, sonra range'i slice et.
    """
    data = await download_file_bytes(message_id)

    if end is None:
        end = len(data) - 1

    chunk = data[start: end + 1]
    chunk_size = 64 * 1024  # 64KB parçalar halinde gönder

    for i in range(0, len(chunk), chunk_size):
        yield chunk[i: i + chunk_size]


async def delete_file(message_id: int):
    """Dosyayı Telegram'dan sil."""
    client = await get_client()
    settings = get_settings()

    await client.delete_messages(settings.telegram_channel_id, message_id)
    cache_service.remove_file(message_id)


async def migrate_to_new_channel(
    new_channel_id: int,
    new_session_string: Optional[str] = None,
    progress_callback=None,
):
    """
    Tüm dosyaları yeni bir Telegram kanalına taşı.
    Dosyalar zaten şifreli olduğu için yeniden şifreleme gerekmez.
    """
    source_client = await get_client()
    settings = get_settings()

    # Hedef client (farklı hesap ise)
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

        # Eski kanaldan şifreli veriyi indir (çözme YOK)
        msg = await source_client.get_messages(
            settings.telegram_channel_id, file_item.message_id
        )
        buf = io.BytesIO()
        await source_client.download_media(msg, file_name=buf, in_memory=True)
        buf.seek(0)
        encrypted_data = buf.read()

        # Yeni kanala yükle (aynı caption)
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

    # Cache'i güncelle
    cache_service.clear_cache()
    for item in new_cache.values():
        cache_service.add_file(item)

    if new_session_string:
        await target_client.stop()
