import asyncio
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from models.schemas import MigrateRequest, MigrateStatus
from services import telegram_service
from services.auth_service import get_current_user

router = APIRouter(prefix="/api/migrate", tags=["migrate"])

# Göç durumunu takip et
_migration_status = MigrateStatus(status="idle")


@router.post("/start")
async def start_migration(
    request: MigrateRequest,
    background_tasks: BackgroundTasks,
    _: str = Depends(get_current_user),
):
    """Kanal göçünü başlat (arka planda çalışır)."""
    global _migration_status

    if _migration_status.status == "running":
        raise HTTPException(status_code=409, detail="Göç zaten devam ediyor")

    _migration_status = MigrateStatus(status="running")
    background_tasks.add_task(
        _run_migration,
        request.new_channel_id,
        request.new_session_string,
    )

    return {"message": "Göç başlatıldı", "status": "running"}


@router.get("/status", response_model=MigrateStatus)
async def get_migration_status(_: str = Depends(get_current_user)):
    """Göç durumunu sorgula."""
    return _migration_status


async def _run_migration(new_channel_id: int, new_session_string=None):
    global _migration_status

    async def progress(current: int, total: int, filename: str):
        _migration_status.total = total
        _migration_status.transferred = current
        _migration_status.current_file = filename

    try:
        await telegram_service.migrate_to_new_channel(
            new_channel_id=new_channel_id,
            new_session_string=new_session_string,
            progress_callback=progress,
        )
        _migration_status.status = "done"
        _migration_status.current_file = ""
    except Exception as e:
        _migration_status.status = "error"
        _migration_status.error = str(e)
