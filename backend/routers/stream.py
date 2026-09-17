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

    # Arka planda TAMAMINI indir — 16 MB/s hizla 73MB dosya 4.6 saniyede cache'e girer
    # Tarayici range istekleri geldiginde her sey bellekten servis edilir → donma yok
    file_size = file.size
    chunk_count = (file_size // (1024 * 1024)) + 2
    asyncio.create_task(telegram_service.prefetch_initial_chunks(message_id, count=chunk_count))
    return {"status": "prefetch_started", "message_id": message_id, "chunks": chunk_count}


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
                yield chunk
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[stream] Hata — id={message_id}: {e}")

    # Her zaman 206 döndür — bazı tarayıcılar (Brave dahil) 200'de seek yapamıyor
    # Content-Length kasıtlı olarak yok: şifreli dosyalarda byte hesabı küçük
    # sapma gösterebilir → "Response content shorter than Content-Length" hatası
    # → tarayıcı isteği baştan tekrar eder → 25 saniyelik bekleme.
    # Content-Length olmadan tarayıcı chunked transfer kullanır — streaming için standarttır.
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

