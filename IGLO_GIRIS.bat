@echo off
chcp 65001 >nul
title IGLO - Telegram Giris

set "VENV_PYTHON=backend\venv\Scripts\python.exe"

if not exist "%VENV_PYTHON%" (
    echo [HATA] Sanal ortam bulunamadi! Once IGLO_BASLAT.bat calistirin.
    pause
    exit /b 1
)

echo ========================================
echo   IGLO TELEGRAM GIRIS (YENILEME)
echo ========================================
echo.
"%VENV_PYTHON%" backend\iglo_login.py
echo.
pause
