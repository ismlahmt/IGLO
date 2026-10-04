"""
Telegram Medya Indirici — kalici oturum havuzu + paralel upload.GetFile.

Neden Pyrogram'in stream_media'si yerine bu modul?
  Pyrogram 2.0.x `get_file()` her cagrida:
    - yeni bir TCP baglantisi + MTProto oturumu acar (Session.start),
    - dosya baska bir DC'deyse YENI bir auth key uretir (DH el sikisma) ve
      Export/ImportAuthorization yapar,
    - 1MB'lik istekleri tek tek, sirayla gonderir,
    - ve `max_concurrent_transmissions=1` yuzunden butun indirmeleri seri yapar.
  Video oynatirken her seek / her prefetch bu maliyeti yeniden oduyordu
  (saniyelerce "yukleniyor" + donmalar).

  Bu modul:
    - Her DC icin birkac media oturumunu BIR KEZ acar ve acik tutar,
    - 1MB'lik chunk'lari bu oturumlar uzerinden PARALEL ister,
    - FILE_REFERENCE_EXPIRED / gecici ag hatalarinda otomatik toparlanir,
    - Hata halinde Pyrogram'in yavas ama calisan yoluna duser (guvenlik agi).
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from pyrogram import raw
from pyrogram.errors import RPCError
from pyrogram.file_id import FileId, FileType
from pyrogram.session import Auth, Session

from config import get_settings
from services import client_pool

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1024 * 1024  # Telegram GetFile icin maksimum (ve hizalama birimi)

# Telegram tarafinda ayni anda acik tutulacak media oturumu sayisi (DC basina)
NUM_SESSIONS = max(1, int(os.environ.get("IGLO_TG_SESSIONS", "4")))
# Oturum basina ayni anda "in-flight" GetFile istegi
PER_SESSION_INFLIGHT = max(1, int(os.environ.get("IGLO_TG_INFLIGHT", "2")))
MAX_INFLIGHT = NUM_SESSIONS * PER_SESSION_INFLIGHT

_MEDIA_KINDS = (
    "document", "video", "audio", "animation", "voice",
    "video_note", "sticker", "photo",
)

# Global es-zamanli GetFile siniri
_gate: Optional[asyncio.Semaphore] = None


def _get_gate() -> asyncio.Semaphore:
    global _gate
    if _gate is None:
        _gate = asyncio.Semaphore(MAX_INFLIGHT)
    return _gate


# ── Dosya konumu (file_id -> InputFileLocation) ──────────────────────────────

class FileLoc:
    __slots__ = ("message_id", "dc_id", "location", "file_size")

    def __init__(self, message_id: int, dc_id: int, location, file_size: int):
        self.message_id = message_id
        self.dc_id = dc_id
        self.location = location
        self.file_size = file_size


_locs: dict[int, FileLoc] = {}
_loc_locks: dict[int, asyncio.Lock] = {}


def _extract_media(msg):
    for kind in _MEDIA_KINDS:
        media = getattr(msg, kind, None)
        if media is not None:
            return media
    raise ValueError("Mesajda indirilebilir medya yok (silinmis olabilir)")


def _build_location(file_id: FileId):
    if file_id.file_type == FileType.PHOTO:
        return raw.types.InputPhotoFileLocation(
            id=file_id.media_id,
            access_hash=file_id.access_hash,
            file_reference=file_id.file_reference,
            thumb_size=file_id.thumbnail_size,
        )
    return raw.types.InputDocumentFileLocation(
        id=file_id.media_id,
        access_hash=file_id.access_hash,
        file_reference=file_id.file_reference,
        thumb_size=file_id.thumbnail_size,
    )


async def _fetch_message(message_id: int):
    client = await client_pool.get_download_client()
    return await client.get_messages(get_settings().telegram_channel_id, message_id)


async def get_loc(message_id: int, stale: Optional[FileLoc] = None) -> FileLoc:
    """
    Dosya konumunu dondur. `stale` verilirse (FILE_REFERENCE_EXPIRED) mesaj
    Telegram'dan yeniden okunup file_reference tazelenir.
    """
    cur = _locs.get(message_id)
    if cur is not None and cur is not stale:
        return cur

    lock = _loc_locks.setdefault(message_id, asyncio.Lock())
    async with lock:
        cur = _locs.get(message_id)
        if cur is not None and cur is not stale:
            return cur

        msg = await _fetch_message(message_id)
        media = _extract_media(msg)
        fid = FileId.decode(media.file_id)
        new = FileLoc(
            message_id=message_id,
            dc_id=fid.dc_id,
            location=_build_location(fid),
            file_size=int(getattr(media, "file_size", 0) or 0),
        )
        _locs[message_id] = new
        return new


def forget(message_id: int):
    _locs.pop(message_id, None)
    _loc_locks.pop(message_id, None)


# ── Oturum havuzu ────────────────────────────────────────────────────────────

class _Slot:
    __slots__ = ("session", "busy")

    def __init__(self, session: Session):
        self.session = session
        self.busy = 0


class _DcPool:
    def __init__(self, dc_id: int, client):
        self.dc_id = dc_id
        self.client = client
        self.slots: list[_Slot] = []
        self.lock = asyncio.Lock()
        self.auth_key: Optional[bytes] = None
        self.fill_task: Optional[asyncio.Task] = None


_pools: dict[int, _DcPool] = {}


async def _start_session(pool: _DcPool, test_mode: bool) -> Session:
    s = Session(pool.client, pool.dc_id, pool.auth_key, test_mode, is_media=True)
    await s.start()
    return s


async def _fill_pool(pool: _DcPool, test_mode: bool):
    """Ilk oturumdan sonra kalan oturumlari arka planda ac."""
    while len(pool.slots) < NUM_SESSIONS:
        try:
            s = await _start_session(pool, test_mode)
            pool.slots.append(_Slot(s))
        except Exception as e:  # noqa: BLE001
            logger.warning("[tg_media] ek oturum acilamadi (dc=%s): %s", pool.dc_id, e)
            return


async def _drop_pool(pool: _DcPool):
    slots, pool.slots = pool.slots, []
    if pool.fill_task and not pool.fill_task.done():
        pool.fill_task.cancel()
    for slot in slots:
        try:
            await slot.session.stop()
        except Exception:  # noqa: BLE001
            pass


async def _get_pool(dc_id: int) -> _DcPool:
    client = await client_pool.get_download_client()

    pool = _pools.get(dc_id)
    if pool is not None and pool.client is client and pool.slots:
        return pool

    if pool is None or pool.client is not client:
        if pool is not None:
            # Ana client yeniden olusturulmus: eski oturumlari birak
            await _drop_pool(pool)
        pool = _DcPool(dc_id, client)
        _pools[dc_id] = pool

    async with pool.lock:
        if pool.slots:
            return pool

        test_mode = await client.storage.test_mode()
        home_dc = await client.storage.dc_id()

        if dc_id != home_dc:
            pool.auth_key = await Auth(client, dc_id, test_mode).create()
        else:
            pool.auth_key = await client.storage.auth_key()

        first = await _start_session(pool, test_mode)

        if dc_id != home_dc:
            exported = await client.invoke(
                raw.functions.auth.ExportAuthorization(dc_id=dc_id)
            )
            await first.invoke(
                raw.functions.auth.ImportAuthorization(
                    id=exported.id, bytes=exported.bytes
                )
            )

        pool.slots.append(_Slot(first))
        logger.info("[tg_media] DC%s ilk media oturumu hazir", dc_id)

        if NUM_SESSIONS > 1:
            pool.fill_task = asyncio.create_task(_fill_pool(pool, test_mode))

    return pool


@asynccontextmanager
async def _acquire_slot(dc_id: int):
    pool = await _get_pool(dc_id)
    slot = min(pool.slots, key=lambda s: s.busy)
    slot.busy += 1
    try:
        yield slot
    finally:
        slot.busy -= 1


async def shutdown():
    for pool in list(_pools.values()):
        await _drop_pool(pool)
    _pools.clear()
    _locs.clear()


# ── Chunk indirme ────────────────────────────────────────────────────────────

def expected_len(file_size: int, idx: int) -> int:
    return max(0, min(CHUNK_SIZE, file_size - idx * CHUNK_SIZE))


def _is_file_ref_error(e: Exception) -> bool:
    ident = str(getattr(e, "ID", "") or e)
    return "FILE_REFERENCE" in ident


async def _fallback_fetch(message_id: int, idx: int) -> bytes:
    """Yavas ama saglam yol: Pyrogram'in kendi stream_media'si."""
    client = await client_pool.get_download_client()
    msg = await _fetch_message(message_id)
    async for chunk in client.stream_media(msg, offset=idx, limit=1):
        return chunk
    return b""


async def fetch_chunk(message_id: int, idx: int, on_start=None) -> bytes:
    """
    Telegram'dan `idx`. 1MB'lik (sifreli/ham) chunk'i indir.
    `on_start`: es-zamanlilik kapisindan gecildiginde (ag istegi baslarken) cagrilir.
    """
    async with _get_gate():
        if on_start:
            on_start()

        loc = await get_loc(message_id)
        want = expected_len(loc.file_size, idx) if loc.file_size else 0
        last_err: Optional[Exception] = None

        for attempt in range(4):
            try:
                async with _acquire_slot(loc.dc_id) as slot:
                    r = await slot.session.invoke(
                        raw.functions.upload.GetFile(
                            location=loc.location,
                            offset=idx * CHUNK_SIZE,
                            limit=CHUNK_SIZE,
                        ),
                        retries=2,
                        timeout=20,
                        sleep_threshold=30,
                    )

                if not isinstance(r, raw.types.upload.File):
                    raise RuntimeError(f"Beklenmeyen GetFile yaniti: {type(r).__name__}")

                data = r.bytes
                if want and len(data) != want:
                    raise IOError(
                        f"Eksik chunk: {len(data)} != {want} (msg={message_id}, idx={idx})"
                    )
                return data

            except RPCError as e:
                last_err = e
                if _is_file_ref_error(e):
                    logger.info("[tg_media] file_reference tazeleniyor msg=%s", message_id)
                    loc = await get_loc(message_id, stale=loc)
                    continue
                if str(getattr(e, "ID", "")) in ("OFFSET_INVALID", "LIMIT_INVALID"):
                    break
                await asyncio.sleep(0.3 * (attempt + 1))
            except (OSError, TimeoutError, asyncio.TimeoutError, RuntimeError) as e:
                last_err = e
                await asyncio.sleep(0.3 * (attempt + 1))

        logger.warning(
            "[tg_media] hizli yol basarisiz (msg=%s idx=%s): %r — Pyrogram'a dusuluyor",
            message_id, idx, last_err,
        )
        data = await _fallback_fetch(message_id, idx)
        if not data:
            raise IOError(f"Chunk indirilemedi (msg={message_id}, idx={idx}): {last_err!r}")
        return data
