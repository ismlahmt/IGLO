"""
Telegram Servisi — Pyrogram ile Telegram islemleri.
Dosya yukleme, indirme, listeleme ve streaming.
"""
import io
import re
import asyncio
import base64
import hashlib
import collections
from datetime import datetime
from typing import Optional, AsyncGenerator
from pyrogram import Client
from pyrogram.types import Message
from config import get_settings
from models.schemas import FileItem
from services import crypto_service, cache_service

# Caption sablonu
CAPTION_PREFIX = "IGLO::v1"

_client: Optional[Client] = None
UPLOAD_PROGRESS = {}

# Mesaj objelerini cache'le
_MSG_CACHE: dict = {}

# -- LRU Chunk Cache --------------------------------------------------------
# Telegram'dan indirilen 1MB'lik chunk'lari bellekte tutar.
# Key: (message_id, chunk_index)  |  Max: 3000 chunk (~3GB)
_CHUNK_CACHE: "collections.OrderedDict[tuple, bytes]" = collections.OrderedDict()
_CHUNK_CACHE_MAX = 3000
STREAM_CHUNK_SIZE = 1024 * 1024  # 1MB


def _cache_put(message_id: int, chunk_index: int, data: bytes):
    """Chunk'i LRU cache'e yaz."""
    key = (message_id, chunk_index)
    _CHUNK_CACHE[key] = data
    _CHUNK_CACHE.move_to_end(key)
    if len(_CHUNK_CACHE) > _CHUNK_CACHE_MAX:
        _CHUNK_CACHE.popitem(last=False)


def _cache_get(message_id: int, chunk_index: int) -> Optional[bytes]:
    """Cache'den chunk getir, yoksa None."""
    key = (message_id, chunk_index)
    if key in _CHUNK_CACHE:
        _CHUNK_CACHE.move_to_end(key)
        return _CHUNK_CACHE[key]
    return None


async def prefetch_initial_chunks(message_id: int, count: int = 12) -> None:
    """
    Video oynatici acilinca ilk N chunk'i tek bir stream_media cagrisiyla indir.
    Boylece oynatma baslar baslamaz buffer dolu olur.
    """
    try:
        client = await get_client()
        settings = get_settings()

        if message_id not in _MSG_CACHE:
            _MSG_CACHE[message_id] = await client.get_messages(
                settings.telegram_channel_id, message_id
            )
        msg = _MSG_CACHE[message_id]

        # Ilk cache'lenmemis chunk'i bul
        start_from = 0
        for i in range(count):
            if _cache_get(message_id, i) is None:
                start_from = i
                break
        else:
            return  # Hepsi zaten cache'te

        remaining = count - start_from
        chunk_idx = start_from
        async for chunk in client.stream_media(msg, offset=start_from, limit=remaining):
            _cache_put(message_id, chunk_idx, chunk)
            chunk_idx += 1

    except Exception as e:
        print(f"[prefetch_initial] hata #{message_id}: {e}")


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


# -- Client -----------------------------------------------------------------

async def get_client() -> Client:
    """Pyrogram client'ini baslat veya mevcut olani dondur."""
    global _client
    settings = get_settings()

    if _client is None or not _client.is_connected:
        if settings.telegram_session_string:
            _client = Client(
                name="iglo",
                api_id=settings.telegram_api_id,
                api_hash=settings.telegram_api_hash,
                session_string=settings.telegram_session_string,
                ipv6=False,
            )
        else:
            _client = Client(
                name="iglo_session",
                api_id=settings.telegram_api_id,
                api_hash=settings.telegram_api_hash,
                workdir=".",
                ipv6=False,
            )
        await _client.start()
        await _resolve_channel_peer(_client, settings.telegram_channel_id)

    return _client


async def _resolve_channel_peer(client: Client, channel_id: int):
    """
    Pyrogram in_memory session her baslatmada entity cache'ini kaybeder.
    Kanali birden fazla yontemle resolve etmeye calis.
    """
    try:
        async for dialog in client.get_dialogs():
            if dialog.chat.id == channel_id:
                return
    except Exception:
        pass

    try:
        await client.resolve_peer(channel_id)  # type: ignore
    except Exception:
        pass


async def shutdown_client():
    """Uygulama kapanirken client'i durdur."""
    global _client
    if _client and _client.is_connected:
        await _client.stop()
    _client = None


# -- Sync -------------------------------------------------------------------

async def sync_from_telegram(full_refresh: bool = False):
    """
    Telegram kanalindan dosyalari oku ve cache'i guncelle.
    full_refresh=True ise tum gecmisi yeniden tara.
    """
    client = await get_client()
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
    client = await get_client()
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
    client = await get_client()
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


# -- Streaming (batch stream_media + LRU cache) ----------------------------
# Pyrogram tek bir media session kullanir. stream_media(limit=70) cagrisi
# o session'i 70 chunk boyunca KILITLER — baska dosyalar sirada bekler.
# Cozum: 5'erli batch'lerle istemek. Her batch arasinda baglanti serbest
# kalir, diger istekler (2MB'lik dosya vb.) arada gecebilir.
STREAM_BATCH_SIZE = 5  # Her batch'te 5 chunk (5MB) indir, sonra baglanti birak


async def stream_file_chunks(
    message_id: int,
    start: int = 0,
    end: Optional[int] = None,
) -> AsyncGenerator[bytes, None]:
    client = await get_client()
    settings = get_settings()
    file_item = cache_service.get_file(message_id)

    if message_id not in _MSG_CACHE:
        _MSG_CACHE[message_id] = await client.get_messages(
            settings.telegram_channel_id, message_id
        )
    msg = _MSG_CACHE[message_id]

    file_size = file_item.size if file_item else 0
    if end is None:
        end = max(file_size - 1, 0)

    # --- Sifresiz dosya ---
    if not file_item or not file_item.encrypted:
        first_chunk = start // STREAM_CHUNK_SIZE
        last_chunk  = end   // STREAM_CHUNK_SIZE

        chunk_idx = first_chunk
        while chunk_idx <= last_chunk:
            # Cache hit -> aninda dondur
            cached = _cache_get(message_id, chunk_idx)
            if cached is not None:
                chunk_start = chunk_idx * STREAM_CHUNK_SIZE
                s = max(0, start - chunk_start) if chunk_idx == first_chunk else 0
                e = min(len(cached), end - chunk_start + 1) if chunk_idx == last_chunk else len(cached)
                if s < e:
                    yield cached[s:e]
                chunk_idx += 1
                continue

            # Cache miss -> batch'lerle Telegram'dan cek (baglanti kitlenmesini onle)
            while chunk_idx <= last_chunk:
                batch_limit = min(STREAM_BATCH_SIZE, last_chunk - chunk_idx + 1)
                async for chunk in client.stream_media(msg, offset=chunk_idx, limit=batch_limit):
                    _cache_put(message_id, chunk_idx, chunk)
                    chunk_start = chunk_idx * STREAM_CHUNK_SIZE
                    s = max(0, start - chunk_start) if chunk_idx == first_chunk else 0
                    e = min(len(chunk), end - chunk_start + 1) if chunk_idx == last_chunk else len(chunk)
                    if s < e:
                        yield chunk[s:e]
                    chunk_idx += 1
                # Batch arasi: event loop'a kontrol ver, diger istekler gecsin
                await asyncio.sleep(0)
        return

    # --- Sifreli dosya ---
    discard_bytes = start % 16
    actual_start  = (start - discard_bytes) + 16
    actual_end    = end + 16

    first_chunk = actual_start // STREAM_CHUNK_SIZE
    last_chunk  = actual_end   // STREAM_CHUNK_SIZE

    # Nonce'u al
    nonce = b""
    if file_item.checksum and file_item.checksum.startswith("aes-ctr:"):
        try:
            nonce_b64 = file_item.checksum.split(":")[1]
            nonce = base64.b64decode(nonce_b64)
        except Exception:
            pass

    if not nonce:
        # Chunk 0'i cache'te ara, yoksa Telegram'dan cek
        cached_0 = _cache_get(message_id, 0)
        if cached_0 is None:
            async for chunk0 in client.stream_media(msg, offset=0, limit=1):
                _cache_put(message_id, 0, chunk0)
                cached_0 = chunk0
                break
        if cached_0 and len(cached_0) >= 16:
            nonce = cached_0[:16]
            nonce_b64 = base64.b64encode(nonce).decode()
            file_item.checksum = f"aes-ctr:{nonce_b64}:" + (file_item.checksum or "")

    if not nonce or len(nonce) < 16:
        return

    decryptor, _ = crypto_service.get_seekable_decryptor(nonce, start - discard_bytes)
    discard = discard_bytes
    first_yield = True

    chunk_idx = first_chunk
    while chunk_idx <= last_chunk:
        # Cache hit
        cached = _cache_get(message_id, chunk_idx)
        if cached is not None:
            chunk_start = chunk_idx * STREAM_CHUNK_SIZE
            s = max(0, actual_start - chunk_start) if chunk_idx == first_chunk else 0
            e = min(len(cached), actual_end - chunk_start + 1) if chunk_idx == last_chunk else len(cached)
            if s < e:
                decrypted = decryptor.update(cached[s:e])
                if first_yield:
                    decrypted = decrypted[discard:]
                    first_yield = False
                if decrypted:
                    yield decrypted
            chunk_idx += 1
            continue

        # Cache miss -> batch'lerle Telegram'dan cek
        while chunk_idx <= last_chunk:
            batch_limit = min(STREAM_BATCH_SIZE, last_chunk - chunk_idx + 1)
            async for chunk in client.stream_media(msg, offset=chunk_idx, limit=batch_limit):
                _cache_put(message_id, chunk_idx, chunk)
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
            # Batch arasi: event loop'a kontrol ver, diger istekler gecsin
            await asyncio.sleep(0)


# -- Delete -----------------------------------------------------------------

async def delete_file(message_id: int):
    """Dosyayi Telegram'dan sil."""
    client = await get_client()
    settings = get_settings()

    await client.delete_messages(settings.telegram_channel_id, message_id)
    cache_service.remove_file(message_id)
    keys_to_remove = [k for k in _CHUNK_CACHE if k[0] == message_id]
    for k in keys_to_remove:
        del _CHUNK_CACHE[k]
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
    source_client = await get_client()
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
