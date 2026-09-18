from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse, FileResponse
from services import telegram_service, cache_service, disk_cache_service, client_pool, crypto_service
from services.auth_service import get_current_user_query
from config import get_settings
import asyncio
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stream", tags=["streaming"])


@router.post("/{message_id}/prefetch")
async def prefetch_video(
    message_id: int,
    _: str = Depends(get_current_user_query),
):
    """
    Arka planda indir (fire-and-forget).
    """
    file = cache_service.get_file(message_id)
    if not file:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    if not disk_cache_service.is_cached(message_id):
        client = await client_pool.get_download_client()
        msg = await client.get_messages(get_settings().telegram_channel_id, message_id)
        asyncio.create_task(
            disk_cache_service.cache_file_from_telegram(
                message_id, client, msg, file, crypto_service
            )
        )
        return {"status": "prefetch_started", "message_id": message_id}
    
    return {"status": "already_cached", "message_id": message_id}


@router.get("/{message_id}")
async def stream_video(
    message_id: int,
    request: Request,
    _: str = Depends(get_current_user_query),
):
    """
    Video/Audio streaming endpoint.
    """
    file = cache_service.get_file(message_id)
    if not file:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    if disk_cache_service.is_cached(message_id):
        disk_cache_service.touch(message_id)
        return FileResponse(
            path=disk_cache_service.get_path(message_id),
            media_type=file.mime_type,
            content_disposition_type="inline"
        )

    file_size = file.size

    range_header = request.headers.get("Range")
    if range_header:
        try:
            range_value = range_header.strip().replace("bytes=", "")
            parts = range_value.split("-")
            start = int(parts[0]) if parts[0] else 0
            end   = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
        except (ValueError, IndexError):
            start, end = 0, file_size - 1
    else:
        start, end = 0, file_size - 1

    end = min(end, file_size - 1)
    if start > end:
        raise HTTPException(status_code=416, detail="Range Not Satisfiable")

    async def generate():
        try:
            async for chunk in telegram_service.stream_file_chunks(message_id, start, end):
                yield chunk
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[stream] Hata — id={message_id}: {e}")

    return StreamingResponse(
        generate(),
        status_code=206,
        media_type=file.mime_type,
        headers={
            "Content-Range":  f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges":  "bytes",
            "Cache-Control":  "no-cache",
        },
    )

