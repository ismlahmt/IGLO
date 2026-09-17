from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from services import telegram_service, cache_service
from services.auth_service import get_current_user_query
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
    İlk 8 chunk'ı arka planda indir (fire-and-forget).
    Frontend video oynatıcı açılınca bu endpoint'i çağırır.
    """
    file = cache_service.get_file(message_id)
    if not file:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    # Arka planda başlat, cevabı beklemeden hemen dön
    asyncio.create_task(telegram_service.prefetch_initial_chunks(message_id, count=8))
    return {"status": "prefetch_started", "message_id": message_id}


@router.get("/{message_id}")
async def stream_video(
    message_id: int,
    request: Request,
    _: str = Depends(get_current_user_query),
):
    """
    Video/Audio streaming endpoint.
    Her zaman HTTP 206 Partial Content döner — tarayıcı seek yapabilsin.
    LRU chunk cache sayesinde daha önce izlenen kısımlar anlık yüklenir.
    """
    file = cache_service.get_file(message_id)
    if not file:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    file_size = file.size

    # Range header'ı işle — yoksa tüm dosyayı serve et
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

    # Sınır kontrolü
    end = min(end, file_size - 1)
    if start > end:
        raise HTTPException(status_code=416, detail="Range Not Satisfiable")

    content_length = end - start + 1

    async def generate():
        try:
            async for chunk in telegram_service.stream_file_chunks(message_id, start, end):
                # Tarayıcı bağlantıyı kestiyse boşa Telegram'dan çekme
                if await request.is_disconnected():
                    logger.debug(f"[stream] Tarayıcı bağlantısı kesildi — stream durduruluyor (id={message_id})")
                    break
                yield chunk
        except asyncio.CancelledError:
            # Tarayıcı isteği iptal etti (seek, yeni range isteği vb.) — normal durum, sessizce çık
            logger.debug(f"[stream] İstek iptal edildi (CancelledError) — id={message_id}, range={start}-{end}")
        except Exception as e:
            logger.error(f"[stream] Beklenmedik hata — id={message_id}: {e}")

    # Her zaman 206 döndür — bazı tarayıcılar (Brave dahil) 200'de seek yapamıyor
    return StreamingResponse(
        generate(),
        status_code=206,
        media_type=file.mime_type,
        headers={
            "Content-Range":  f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges":  "bytes",
            "Content-Length": str(content_length),
            "Cache-Control":  "public, max-age=3600",
        },
    )

