import io
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Form
from fastapi.responses import StreamingResponse
from typing import Optional
from models.schemas import FileItem, UploadResponse
from services import telegram_service, cache_service
from services.auth_service import get_current_user

router = APIRouter(prefix="/api/files", tags=["files"])


@router.get("", response_model=list[FileItem])
async def list_files(
    folder: Optional[str] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
    _: str = Depends(get_current_user),
):
    """Tüm dosyaları listele. Opsiyonel filtreler: folder, category, search."""
    files = cache_service.get_all_files()

    if folder:
        files = [f for f in files if f.folder == folder]
    if category:
        files = [f for f in files if f.file_category == category]
    if search:
        query = search.lower()
        files = [f for f in files if query in f.name.lower()]

    return files


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    folder: str = Form(default="/"),
    _: str = Depends(get_current_user),
):
    """Dosya yükle — şifrele ve Telegram'a gönder."""
    try:
        data = await file.read()
        mime_type = file.content_type or "application/octet-stream"

        result = await telegram_service.upload_file(
            file_data=data,
            filename=file.filename,
            mime_type=mime_type,
            folder=folder,
        )
        return UploadResponse(success=True, file=result, message="Dosya yüklendi")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Yükleme hatası: {str(e)}")


@router.delete("/{message_id}")
async def delete_file(
    message_id: int,
    _: str = Depends(get_current_user),
):
    """Dosyayı Telegram'dan ve cache'den sil."""
    file = cache_service.get_file(message_id)
    if not file:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    await telegram_service.delete_file(message_id)
    return {"success": True, "message": f"{file.name} silindi"}


@router.get("/download/{message_id}")
async def download_file(
    message_id: int,
    _: str = Depends(get_current_user),
):
    """Dosyayı indir (şifre çözülerek)."""
    file = cache_service.get_file(message_id)
    if not file:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    try:
        data = await telegram_service.download_file_bytes(message_id)
        return StreamingResponse(
            io.BytesIO(data),
            media_type=file.mime_type,
            headers={
                "Content-Disposition": f'attachment; filename="{file.name}"',
                "Content-Length": str(len(data)),
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"İndirme hatası: {str(e)}")


@router.post("/sync")
async def sync_files(
    full_refresh: bool = False,
    _: str = Depends(get_current_user),
):
    """Telegram'dan cache'i güncelle."""
    try:
        new_files = await telegram_service.sync_from_telegram(full_refresh=full_refresh)
        return {
            "success": True,
            "new_files": len(new_files),
            "message": f"{len(new_files)} yeni dosya bulundu",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Senkronizasyon hatası: {str(e)}")


@router.get("/stats")
async def get_stats(_: str = Depends(get_current_user)):
    """Cache istatistiklerini döndür."""
    return cache_service.get_stats()
