from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from services import telegram_service, cache_service
from services.auth_service import get_current_user

router = APIRouter(prefix="/api/stream", tags=["streaming"])


@router.get("/{message_id}")
async def stream_video(
    message_id: int,
    request: Request,
    _: str = Depends(get_current_user),
):
    """
    Video/Audio streaming endpoint.
    HTTP Range header'ı destekler — seek (ileri/geri sarma) çalışır.
    """
    file = cache_service.get_file(message_id)
    if not file:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    file_size = file.size

    # Range header'ı işle
    range_header = request.headers.get("Range")
    if range_header:
        try:
            range_value = range_header.strip().replace("bytes=", "")
            parts = range_value.split("-")
            start = int(parts[0]) if parts[0] else 0
            end = int(parts[1]) if parts[1] else file_size - 1
        except (ValueError, IndexError):
            start, end = 0, file_size - 1
    else:
        start, end = 0, file_size - 1

    end = min(end, file_size - 1)
    content_length = end - start + 1

    async def generate():
        async for chunk in telegram_service.stream_file_chunks(message_id, start, end):
            yield chunk

    status_code = 206 if range_header else 200

    return StreamingResponse(
        generate(),
        status_code=status_code,
        media_type=file.mime_type,
        headers={
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Cache-Control": "no-cache",
        },
    )
