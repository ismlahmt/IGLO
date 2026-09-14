"""
IGLO — FastAPI Ana Uygulama
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import get_settings
from services import telegram_service
from routers import auth, files, stream, migrate


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Uygulama başlangıç ve bitiş işlemleri."""
    settings = get_settings()

    # Başlangıç: Telegram'a bağlan ve cache güncelle
    print("🚀 IGLO başlatılıyor...")

    if settings.telegram_api_id and settings.telegram_api_hash:
        try:
            print("📡 Telegram'a bağlanılıyor...")
            await telegram_service.sync_from_telegram(full_refresh=False)
            print("✅ Telegram bağlantısı kuruldu, cache güncellendi")
        except Exception as e:
            print(f"⚠️  Telegram bağlantı hatası: {e}")
            print("    .env dosyasını kontrol edin")
    else:
        print("⚠️  Telegram bilgileri eksik — .env dosyasını yapılandırın")

    yield

    # Kapanış: Telegram client'ı durdur
    print("🛑 IGLO kapatılıyor...")
    await telegram_service.shutdown_client()


settings = get_settings()

app = FastAPI(
    title="IGLO API",
    description="Kişisel Telegram Cloud Sistemi",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Router'ları ekle
app.include_router(auth.router)
app.include_router(files.router)
app.include_router(stream.router)
app.include_router(migrate.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "IGLO"}


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Sunucu hatası: {str(exc)}"},
    )
