"""
Thumbnail Router — Video dosyalarından önizleme karesi üretir.

Neden pipe değil temp dosya?
  MP4 formatında moov (başlık) atom genellikle dosyanın SONUNDA bulunur.
  ffmpeg pipe'tan okuyunca başa dönemez → decode edemez → hata.
  Temp dosyaya yazıp ffmpeg'i dosya üzerinde çalıştırınca bu sorun olmaz.

Akış:
  1. Dosyanın ilk 8 MB'ını stream_file_chunks ile şifresiz çek
  2. Geçici dosyaya yaz
  3. ffmpeg ile 1. saniye karesini JPEG olarak al
  4. thumbnails/{message_id}.jpg olarak cache'le
  5. Sonraki isteklerde cache'den dön (hiç Telegram/ffmpeg yok)
"""
import os
import asyncio
import tempfile
import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from services import cache_service, telegram_service
from services.auth_service import get_current_user_query

router = APIRouter(prefix="/api/stream", tags=["thumbnail"])

THUMBNAIL_DIR = Path(__file__).parent.parent / "thumbnails"
THUMBNAIL_DIR.mkdir(exist_ok=True)

# Video formatları — bu uzantılar için thumbnail üret
VIDEO_EXTS = {"mp4", "mkv", "avi", "mov", "webm", "m4v", "flv", "wmv", "ts", "m2ts"}

# Thumbnail üretmek için indirilen max byte
# 8 MB — çoğu videonun container başlığı (moov atom) burada yer alır.
# "Fast start" MP4 ve MKV dosyaları için yeterlidir.
THUMB_PREFETCH_BYTES = 8 * 1024 * 1024


def _get_ffmpeg() -> str | None:
    """
    ffmpeg binary konumunu bul.
    1. Sistem PATH — her şeyin üstünde
    2. imageio-ffmpeg paketi — pip ile gelir, sistem kurulumu gerekmez
    """
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


async def _generate_thumbnail(message_id: int, thumb_path: Path, token: str) -> bool:
    """
    Videodan thumbnail üret, thumb_path'e kaydet.
    ffmpeg doğrudan backend'in stream endpoint'ini okuyarak range istekleriyle moov atom'u bulur.
    """
    ffmpeg = _get_ffmpeg()
    if not ffmpeg:
        return False

    file_item = cache_service.get_file(message_id)
    if not file_item:
        return False

    ext = file_item.name.rsplit(".", 1)[-1].lower() if "." in file_item.name else ""
    if ext not in VIDEO_EXTS:
        return False

    # ── ffmpeg doğrudan stream endpoint'inden okuyacak ──
    from config import get_settings
    settings = get_settings()
    port = settings.backend_port

    port = os.environ.get("PORT", settings.backend_port)
    stream_url = f"http://127.0.0.1:{port}/api/stream/{message_id}?token={token}"

    try:
        loop = asyncio.get_event_loop()
        success = await loop.run_in_executor(
            None, _run_ffmpeg, ffmpeg, stream_url, str(thumb_path)
        )
        return success
    except Exception as e:
        print(f"[thumbnail] Genel hata #{message_id}: {e}")
        return False


def _run_ffmpeg(ffmpeg: str, input_url: str, output_path: str) -> bool:
    """
    ffmpeg'i senkron çalıştır (run_in_executor içinde).
    Önce 1. saniye karesini dene, başarısız olursa ilk kareyi al.
    """
    def attempt(extra_args: list[str]) -> bool:
        try:
            result = subprocess.run(
                [
                    ffmpeg,
                    "-loglevel", "error",
                    "-i", input_url,
                    *extra_args,
                    "-vframes", "1",
                    "-vf", "scale=480:-2",      # 480px genişlik, oran korunur
                    "-q:v", "3",                # JPEG kalitesi (1=en iyi, 31=en kötü)
                    "-y",                       # Üzerine yaz
                    output_path,
                ],
                capture_output=True,
                timeout=30, # Ağı okuduğu için timeout'u biraz arttırdık
            )
            return (
                result.returncode == 0
                and os.path.exists(output_path)
                and os.path.getsize(output_path) > 0
            )
        except subprocess.TimeoutExpired:
            print(f"[thumbnail] ffmpeg timeout")
            return False
        except Exception as e:
            print(f"[thumbnail] ffmpeg hata: {e}")
            return False

    # Deneme 1: 1. saniye (karanlık başlangıç sahnelerini atla)
    if attempt(["-ss", "00:00:01"]):
        return True

    # Deneme 2: İlk kare (bazı videolar 1 sn'den kısa olabilir)
    if attempt([]):
        return True

    print(f"[thumbnail] Üretilemedi")
    return False


@router.get("/{message_id}/thumbnail")
async def get_thumbnail(
    message_id: int,
    token: str = Depends(get_current_user_query),
):
    """
    Video thumbnail endpoint.
    - Cache'te varsa anında döner (Telegram/ffmpeg yok).
    - Yoksa üretir (ilk istek biraz sürebilir).
    - Video değilse veya üretilemediyse 404 döner.
    """
    thumb_path = THUMBNAIL_DIR / f"{message_id}.jpg"

    # ── Cache hit ──
    if thumb_path.exists() and thumb_path.stat().st_size > 0:
        return FileResponse(
            str(thumb_path),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    # ── ffmpeg kontrolü ──
    if not _get_ffmpeg():
        raise HTTPException(
            status_code=503,
            detail="ffmpeg bulunamadı. 'pip install imageio-ffmpeg' çalıştırın.",
        )

    # ── Thumbnail üret ──
    success = await _generate_thumbnail(message_id, thumb_path, token)

    if not success or not thumb_path.exists() or thumb_path.stat().st_size == 0:
        # Thumbnail üretilemedi — 204 No Content (FileCard icon'a düşer)
        raise HTTPException(status_code=404, detail="Thumbnail üretilemedi")

    return FileResponse(
        str(thumb_path),
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )
