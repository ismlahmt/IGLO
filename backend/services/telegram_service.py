"""
Telegram Servisi — Pyrogram ile Telegram işlemleri.
Dosya yükleme, indirme, listeleme ve streaming.
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

# Caption şablonu — Telegram mesajına yazılacak format
CAPTION_PREFIX = "IGLO::v1"

_client: Optional[Client] = None

UPLOAD_PROGRESS = {}

# Mesaj objelerini cache'le — her stream isteğinde Telegram'a gitmez
_MSG_CACHE: dict = {}

# ── LRU Chunk Cache ──────────────────────────────────────────────────────────
# Telegram'dan indirilen 1MB'lık chunk'ları bellekte tutar.
# Seek yapıldığında aynı chunk tekrar Telegram'dan çekilmez → anlık atlama.
# Key: (message_id, chunk_index)  |  Max: 150 chunk (~150MB)
_CHUNK_CACHE: "collections.OrderedDict[tuple, bytes]" = collections.OrderedDict()
_CHUNK_CACHE_MAX = 150
STREAM_CHUNK_SIZE = 1024 * 1024  # 1MB — Pyrogram'ın iç chunk boyutuyla eşleşir

# ── Prefetch Task Tablosu ─────────────────────────────────────────────────────
_PREFETCH_TASKS: "dict[tuple, asyncio.Task]" = {}
PREFETCH_AHEAD     = 4   # Kaç chunk ilerisini önceden indir (4MB lookahead)
MAX_PREFETCH_TASKS = 8   # Aynı anda en fazla bu kadar prefetch task çalışsın

# ── Telegram Bağlantı Semaphore ───────────────────────────────────────────────
# Eş zamanlı Telegram indirme sayısını sınırlar — rate-limit ve bellek koruması.
# Stream isteği + prefetch birlikte max 3 bağlantı açabilir.
_TELEGRAM_SEMAPHORE: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    """Event loop başladıktan sonra semaphore'u oluştur (lazy init)."""
    global _TELEGRAM_SEMAPHORE
    if _TELEGRAM_SEMAPHORE is None:
        _TELEGRAM_SEMAPHORE = asyncio.Semaphore(3)
    return _TELEGRAM_SEMAPHORE


async def _get_chunk(client: Client, msg, message_id: int, chunk_index: int) -> bytes:
    """
    Tek bir Telegram chunk'ını LRU cache veya çalışan prefetch task'tan getir.
    İkisi de yoksa Telegram'dan çekip cache'e yaz.

    Cache hit  → anında dön (~0ms)
    Task hit   → await et (tekrar bağlantı açma)
    Miss       → semaphore ile Telegram'dan çek, cache'e yaz
    """
    key = (message_id, chunk_index)

    # 1. Cache hit — en hızlı yol
    if key in _CHUNK_CACHE:
        _CHUNK_CACHE.move_to_end(key)
        return _CHUNK_CACHE[key]

    # 2. Prefetch task çalışıyor — await et, yeni bağlantı açma
    if key in _PREFETCH_TASKS:
        try:
            data = await asyncio.shield(_PREFETCH_TASKS[key])
            if data and key not in _CHUNK_CACHE:
                _CHUNK_CACHE[key] = data
                _CHUNK_CACHE.move_to_end(key)
                if len(_CHUNK_CACHE) > _CHUNK_CACHE_MAX:
                    _CHUNK_CACHE.popitem(last=False)
            return data if data else b""
        except Exception:
            pass  # Task iptal/hata → aşağıda doğrudan çek

    # 3. Semaphore ile Telegram'dan çek (eş zamanlı bağlantı sınırı)
    async with _get_semaphore():
        # Semaphore beklerken başka task cache'e yazmış olabilir
        if key in _CHUNK_CACHE:
            _CHUNK_CACHE.move_to_end(key)
            return _CHUNK_CACHE[key]

        data = b""
        try:
            async for chunk in client.stream_media(msg, limit=1, offset=chunk_index):
                data = chunk
                break
        except Exception:
            return b""  # Hata → boş dön, streaming devam etsin

    _CHUNK_CACHE[key] = data
    _CHUNK_CACHE.move_to_end(key)
    if len(_CHUNK_CACHE) > _CHUNK_CACHE_MAX:
        _CHUNK_CACHE.popitem(last=False)

    return data


def _schedule_prefetch(client: Client, msg, message_id: int, current_chunk: int) -> None:
    """
    Mevcut chunk'ın ötesini arka planda indir (fire-and-forget).
    MAX_PREFETCH_TASKS aşıldığında yeni task açılmaz → bellek/bağlantı koruması.
    """
    if len(_PREFETCH_TASKS) >= MAX_PREFETCH_TASKS:
        return

    for offset in range(1, PREFETCH_AHEAD + 1):
        next_idx = current_chunk + offset
        key = (message_id, next_idx)

        if key in _CHUNK_CACHE or key in _PREFETCH_TASKS:
            continue
        if len(_PREFETCH_TASKS) >= MAX_PREFETCH_TASKS:
            break

        task = asyncio.create_task(
            _get_chunk(client, msg, message_id, next_idx)
        )
        _PREFETCH_TASKS[key] = task
        task.add_done_callback(lambda t, k=key: _PREFETCH_TASKS.pop(k, None))


async def prefetch_initial_chunks(message_id: int, count: int = 8) -> None:
    """
    Video oynatıcı açılınca ilk N chunk'ı (N*1MB) arka planda indir.
    Bu sayede oynatma başlar başlamaz buffer bar ileri gider ve donma azalır.
    """
    try:
        client   = await get_client()
        settings = get_settings()

        if message_id not in _MSG_CACHE:
            _MSG_CACHE[message_id] = await client.get_messages(
                settings.telegram_channel_id, message_id
            )
        msg = _MSG_CACHE[message_id]

        for i in range(count):
            key = (message_id, i)
            if key in _CHUNK_CACHE or key in _PREFETCH_TASKS:
                continue
            if len(_PREFETCH_TASKS) >= MAX_PREFETCH_TASKS:
                break
            task = asyncio.create_task(_get_chunk(client, msg, message_id, i))
            _PREFETCH_TASKS[key] = task
            task.add_done_callback(lambda t, k=key: _PREFETCH_TASKS.pop(k, None))

    except Exception as e:
        print(f"[prefetch_initial] hata #{message_id}: {e}")


# ── Caption helpers ──────────────────────────────────────────────────────────

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


# ── Client ───────────────────────────────────────────────────────────────────

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
    Pyrogram in_memory session her başlatmada entity cache'ini kaybeder.
    Kanalı birden fazla yöntemle resolve etmeye çalış.
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
    """Uygulama kapanırken client'ı durdur."""
    global _client
    if _client and _client.is_connected:
        await _client.stop()
    _client = None


# ── Sync ─────────────────────────────────────────────────────────────────────

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


# ── Upload ────────────────────────────────────────────────────────────────────

async def upload_file(
    file_data: bytes,
    filename: str,
    mime_type: str,
    folder: str = "/",
    upload_id: str = None
) -> FileItem:
    """Dosyayı şifrele ve Telegram'a yükle."""
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


# ── Download ──────────────────────────────────────────────────────────────────

async def download_file_bytes(message_id: int) -> bytes:
    """Dosyayı Telegram'dan indir ve şifresini çöz."""
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


# ── Streaming (LRU cache ile) ─────────────────────────────────────────────────

async def stream_file_chunks(
    message_id: int,
    start: int = 0,
    end: Optional[int] = None,
) -> AsyncGenerator[bytes, None]:
    """
    Video/Audio streaming — chunk başına LRU cache kullanır.
    - Cache hit  → Telegram API çağrısı yapılmaz, anlık yanıt (seek hızlı).
    - Cache miss → Telegram'dan çekilir, cache'e yazılır.
    """
    client = await get_client()
    settings = get_settings()
    file_item = cache_service.get_file(message_id)

    # Mesaj objesini cache'le
    if message_id not in _MSG_CACHE:
        _MSG_CACHE[message_id] = await client.get_messages(
            settings.telegram_channel_id, message_id
        )
    msg = _MSG_CACHE[message_id]

    # end belirtilmemişse dosyanın sonuna kadar aktar
    file_size = file_item.size if file_item else 0
    if end is None:
        end = max(file_size - 1, 0)

    # ── Şifresiz dosya ────────────────────────────────────────────────────────
    if not file_item or not file_item.encrypted:
        first_chunk = start // STREAM_CHUNK_SIZE
        last_chunk  = end   // STREAM_CHUNK_SIZE

        for chunk_idx in range(first_chunk, last_chunk + 1):
            chunk = await _get_chunk(client, msg, message_id, chunk_idx)
            if not chunk:
                break

            # Sonraki chunk'ları arka planda indir
            _schedule_prefetch(client, msg, message_id, chunk_idx)

            chunk_start = chunk_idx * STREAM_CHUNK_SIZE
            slice_start = max(0, start - chunk_start) if chunk_idx == first_chunk else 0
            slice_end   = (
                min(len(chunk), end - chunk_start + 1)
                if chunk_idx == last_chunk else len(chunk)
            )

            if slice_start < slice_end:
                yield chunk[slice_start:slice_end]
        return

    # ── Şifreli (AES-CTR) dosya ───────────────────────────────────────────────
    # Telegram'daki gerçek byte konumları: nonce (16B) + şifreli veri
    actual_start = start + 16
    actual_end   = end   + 16

    first_chunk = actual_start // STREAM_CHUNK_SIZE
    last_chunk  = actual_end   // STREAM_CHUNK_SIZE

    # Nonce'u bul (checksum'dan veya chunk 0'dan)
    nonce = b""
    if file_item.checksum and file_item.checksum.startswith("aes-ctr:"):
        try:
            nonce_b64 = file_item.checksum.split(":")[1]
            nonce = base64.b64decode(nonce_b64)
        except Exception:
            pass

    if not nonce:
        # Chunk 0 zaten cache'de olabilir (önceki oynatmadan)
        chunk0 = await _get_chunk(client, msg, message_id, 0)
        if len(chunk0) >= 16:
            nonce = chunk0[:16]
            nonce_b64 = base64.b64encode(nonce).decode()
            file_item.checksum = f"aes-ctr:{nonce_b64}:" + (file_item.checksum or "")

    # Seekable AES-CTR decryptor oluştur
    decryptor = None
    discard = 0
    if nonce and len(nonce) >= 16:
        decryptor, discard = crypto_service.get_seekable_decryptor(nonce, start)

    first_yield = True

    for chunk_idx in range(first_chunk, last_chunk + 1):
        chunk = await _get_chunk(client, msg, message_id, chunk_idx)
        if not chunk:
            break

        # Sonraki chunk'ları arka planda indir
        _schedule_prefetch(client, msg, message_id, chunk_idx)

        chunk_start = chunk_idx * STREAM_CHUNK_SIZE

        # Eğer chunk 0'dan nonce henüz alınmamışsa al
        if not nonce and chunk_idx == 0 and first_yield:
            if len(chunk) >= 16:
                nonce = chunk[:16]
                nonce_b64 = base64.b64encode(nonce).decode()
                file_item.checksum = f"aes-ctr:{nonce_b64}:" + (file_item.checksum or "")
                decryptor, discard = crypto_service.get_seekable_decryptor(nonce, start)

        slice_start = max(0, actual_start - chunk_start) if chunk_idx == first_chunk else 0
        slice_end   = (
            min(len(chunk), actual_end - chunk_start + 1)
            if chunk_idx == last_chunk else len(chunk)
        )

        if slice_start >= slice_end:
            continue

        data_to_decrypt = chunk[slice_start:slice_end]

        if decryptor:
            decrypted = decryptor.update(data_to_decrypt)
        else:
            decrypted = data_to_decrypt  # Fallback

        if first_yield:
            decrypted = decrypted[discard:]
            first_yield = False

        if decrypted:
            yield decrypted


# ── Delete ────────────────────────────────────────────────────────────────────

async def delete_file(message_id: int):
    """Dosyayı Telegram'dan sil."""
    client = await get_client()
    settings = get_settings()

    await client.delete_messages(settings.telegram_channel_id, message_id)
    cache_service.remove_file(message_id)
    # Cache'den de temizle
    keys_to_remove = [k for k in _CHUNK_CACHE if k[0] == message_id]
    for k in keys_to_remove:
        del _CHUNK_CACHE[k]
    _MSG_CACHE.pop(message_id, None)


# ── Migration ─────────────────────────────────────────────────────────────────

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

        msg = await source_client.get_messages(
            settings.telegram_channel_id, file_item.message_id
        )
        res = await source_client.download_media(msg, in_memory=True)
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
