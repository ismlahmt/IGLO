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
        client = await client_pool.get_cache_client()
        msg = await client.get_messages(get_settings().telegram_channel_id, message_id)
        telegram_service._start_caching_task(message_id, client, msg, file, crypto_service)
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
        status_code = 206
    else:
        start, end = 0, file_size - 1
        status_code = 200

    end = min(end, file_size - 1)
    
    logger.info(f"[stream] msg_id={message_id}, Range={range_header}, start={start}, end={end}, size={file_size}, status={status_code}")

    if start > end:
        logger.error(f"[stream] Invalid range for msg_id={message_id}: start={start} > end={end}")
        raise HTTPException(status_code=416, detail="Range Not Satisfiable")

    async def generate():
        try:
            async for chunk in telegram_service.stream_file_chunks(message_id, start, end):
                yield chunk
        except asyncio.CancelledError:
            logger.info(f"[stream] Cancelled msg_id={message_id}")
        except Exception as e:
            logger.error(f"[stream] Error msg_id={message_id}: {e}")

    headers = {
        "Accept-Ranges":  "bytes",
        "Content-Length": str(end - start + 1),
        "Cache-Control":  "no-cache",
    }
    
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    logger.info(f"[stream] Responding msg_id={message_id} with headers: {headers}")

    return StreamingResponse(
        generate(),
        status_code=status_code,
        media_type=file.mime_type,
        headers=headers,
    )


