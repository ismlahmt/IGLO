from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from services import telegram_service, cache_service, disk_cache_service
from services.auth_service import get_current_user_query
import asyncio
import logging
import re

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stream", tags=["streaming"])

_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")

# Arka plan prefetch gorevlerine referans tut (GC'lenmesinler)
_BG_TASKS: set = set()


@router.post("/{message_id}/prefetch")
async def prefetch_video(
    message_id: int,
    _: str = Depends(get_current_user_query),
):
    """
    Oynatici acilinca cagrilir. ANINDA doner; ilk ve son chunk'lar arka planda
    isitilir (moov atom icin). Oynatma bu istegin bitmesini BEKLEMEZ.
    """
    file = cache_service.get_file(message_id)
    if not file:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    if disk_cache_service.is_cached(message_id):
        return {"status": "already_cached", "message_id": message_id}

    task = asyncio.create_task(telegram_service.prefetch_ends_to_chunk_cache(message_id))
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)

    return {"status": "prefetch_started", "message_id": message_id}


def _parse_range(header: str, size: int):
    """(start, end) dondurur; gecersizse None; karsilanamazsa 'unsatisfiable'."""
    m = _RANGE_RE.match(header.strip())
    if not m:
        return None
    s, e = m.groups()
    if s == "" and e == "":
        return None
    if s == "":
        # suffix range: son N bayt
        n = int(e)
        if n == 0:
            return "unsatisfiable"
        return max(0, size - n), size - 1
    start = int(s)
    end = int(e) if e else size - 1
    if start >= size or (e and end < start):
        return "unsatisfiable"
    return start, min(end, size - 1)


@router.get("/{message_id}")
async def stream_video(
    message_id: int,
    request: Request,
    _: str = Depends(get_current_user_query),
):
    """
    Video/Audio streaming endpoint (HTTP Range destekli).
    """
    file = cache_service.get_file(message_id)
    if not file:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    file_size = file.size
    if file_size <= 0:
        return Response(status_code=204)

    range_header = request.headers.get("Range")
    status_code = 200
    start, end = 0, file_size - 1

    if range_header:
        parsed = _parse_range(range_header, file_size)
        if parsed == "unsatisfiable":
            return Response(
                status_code=416,
                headers={"Content-Range": f"bytes */{file_size}"},
            )
        if parsed is not None:
            start, end = parsed
            status_code = 206

    logger.debug("[stream] msg=%s Range=%s -> %s-%s/%s", message_id, range_header, start, end, file_size)

    # Eski surumden kalan, tamamen inmis duz metin dosya varsa direkt diskten ver
    if disk_cache_service.is_cached(message_id):
        disk_cache_service.touch(message_id)
        path = disk_cache_service.get_path(message_id)

        async def body():
            import aiofiles
            async with aiofiles.open(path, mode="rb") as f:
                await f.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    data = await f.read(min(1024 * 1024, remaining))
                    if not data:
                        break
                    yield data
                    remaining -= len(data)
    else:
        async def body():
            gen = telegram_service.stream_file_chunks(message_id, start, end)
            try:
                async for chunk in gen:
                    yield chunk
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                logger.error("[stream] msg=%s hata: %r", message_id, e)
            finally:
                await gen.aclose()

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(end - start + 1),
        "Cache-Control": "private, no-cache",
        "X-Accel-Buffering": "no",
    }
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    return StreamingResponse(
        body(),
        status_code=status_code,
        media_type=file.mime_type,
        headers=headers,
    )
