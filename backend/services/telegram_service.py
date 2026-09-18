"""
Telegram Servisi — Pyrogram ile Telegram islemleri.
Dosya yukleme, indirme, listeleme ve streaming.
"""
import io
import re
import asyncio
import base64
import hashlib
from datetime import datetime
from typing import Optional, AsyncGenerator
from pyrogram.types import Message
from config import get_settings
from models.schemas import FileItem
from services import crypto_service, cache_service, client_pool, disk_cache_service

# Caption sablonu
CAPTION_PREFIX = "IGLO::v1"

UPLOAD_PROGRESS = {}

# Mesaj objelerini cache'le
_MSG_CACHE: dict = {}
STREAM_CHUNK_SIZE = 1024 * 1024  # 1MB


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
    """Dosyayi Telegram'dan indir ve sifresini coz."""
    client = await client_pool.get_download_client()
    settings = get_settings()

    file_item = cache_service.get_file(message_id)

    res = await client.download_media(
        message=await client.get_messages(settings.telegram_channel_id, message_id),
        in_memory=True,
    )
    data = res.getvalue() if res else b""

    if file_item and file_item.encrypted:
        data = crypto_service.decrypt_bytes(data)

    return data


# -- Streaming --------------------------------------------------------------

async def stream_file_chunks(
    message_id: int,
    start: int = 0,
    end: Optional[int] = None,
) -> AsyncGenerator[bytes, None]:
    client = await client_pool.get_download_client()
    settings = get_settings()
    file_item = cache_service.get_file(message_id)

    if message_id not in _MSG_CACHE:
        _MSG_CACHE[message_id] = await client.get_messages(
            settings.telegram_channel_id, message_id
        )
    msg = _MSG_CACHE[message_id]

    asyncio.create_task(disk_cache_service.cache_file_from_telegram(message_id, client, msg, file_item, crypto_service))

    file_size = file_item.size if file_item else 0
    if end is None:
        end = max(file_size - 1, 0)

    # --- Sifresiz dosya ---
    if not file_item or not file_item.encrypted:
        first_chunk = start // STREAM_CHUNK_SIZE
        last_chunk  = end   // STREAM_CHUNK_SIZE
        remaining = last_chunk - first_chunk + 1
        chunk_idx = first_chunk
        
        async for chunk in client.stream_media(msg, offset=first_chunk, limit=remaining):
            chunk_start = chunk_idx * STREAM_CHUNK_SIZE
            s = max(0, start - chunk_start) if chunk_idx == first_chunk else 0
            e = min(len(chunk), end - chunk_start + 1) if chunk_idx == last_chunk else len(chunk)
            if s < e:
                yield chunk[s:e]
            chunk_idx += 1
        return

    # --- Sifreli dosya ---
    discard_bytes = start % 16
    actual_start  = (start - discard_bytes) + 16
    actual_end    = end + 16

    first_chunk = actual_start // STREAM_CHUNK_SIZE
    last_chunk  = actual_end   // STREAM_CHUNK_SIZE
    remaining = last_chunk - first_chunk + 1

    # Nonce'u al
    nonce = b""
    if file_item.checksum and file_item.checksum.startswith("aes-ctr:"):
        try:
            nonce_b64 = file_item.checksum.split(":")[1]
            nonce = base64.b64decode(nonce_b64)
        except Exception:
            pass

    if not nonce:
        async for chunk0 in client.stream_media(msg, offset=0, limit=1):
            if chunk0 and len(chunk0) >= 16:
                nonce = chunk0[:16]
                nonce_b64 = base64.b64encode(nonce).decode()
                file_item.checksum = f"aes-ctr:{nonce_b64}:" + (file_item.checksum or "")
            break

    if not nonce or len(nonce) < 16:
        return

    decryptor, _ = crypto_service.get_seekable_decryptor(nonce, start - discard_bytes)
    discard = discard_bytes
    first_yield = True

    chunk_idx = first_chunk
    async for chunk in client.stream_media(msg, offset=first_chunk, limit=remaining):
        chunk_start = chunk_idx * STREAM_CHUNK_SIZE
        s = max(0, actual_start - chunk_start) if chunk_idx == first_chunk else 0
        e = min(len(chunk), actual_end - chunk_start + 1) if chunk_idx == last_chunk else len(chunk)
        if s < e:
            decrypted = decryptor.update(chunk[s:e])
            if first_yield:
                decrypted = decrypted[discard:]
                first_yield = False
            if decrypted:
                yield decrypted
        chunk_idx += 1


# -- Delete -----------------------------------------------------------------

async def delete_file(message_id: int):
    """Dosyayi Telegram'dan sil."""
    client = await client_pool.get_upload_client()
    settings = get_settings()

    await client.delete_messages(settings.telegram_channel_id, message_id)
    cache_service.remove_file(message_id)
    disk_cache_service.remove(message_id)
    _MSG_CACHE.pop(message_id, None)


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
