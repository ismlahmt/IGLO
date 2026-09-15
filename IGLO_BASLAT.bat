@echo off
chcp 65001 >nul
title IGLO - Baslatiliyor...

set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "FRONTEND_DIR=%SCRIPT_DIR%frontend"
set "VENV_PYTHON=%BACKEND_DIR%\venv\Scripts\python.exe"
set "VENV_UVICORN=%BACKEND_DIR%\venv\Scripts\uvicorn.exe"

echo.
echo  ==========================================
echo    IGLO - Kisisel Telegram Cloud Sistemi
echo  ==========================================
echo.

:: --- Backend .env kontrolu ---
if not exist "%BACKEND_DIR%\.env" (
    echo [HATA] backend\.env dosyasi bulunamadi!
    echo   Cozum: backend\.env.example dosyasini kopyalayip duzenle
    echo.
    pause
    exit /b 1
)

:: --- venv kontrolu / kurulum ---
if not exist "%VENV_PYTHON%" (
    echo [!] Sanal ortam bulunamadi, olusturuluyor...
    python -m venv "%BACKEND_DIR%\venv"
    if errorlevel 1 (
        echo [HATA] venv olusturulamadi! Python kurulu mu?
        pause
        exit /b 1
    )
    echo [OK] Sanal ortam olusturuldu.
)

:: --- pip bagimlilikler ---
if not exist "%VENV_UVICORN%" (
    echo [!] Bagimlilikler kuruluyor...
    "%VENV_PYTHON%" -m pip install -r "%BACKEND_DIR%\requirements.txt" --quiet
    if errorlevel 1 (
        echo [HATA] pip install basarisiz!
        pause
        exit /b 1
    )
    echo [OK] Bagimlilikler kuruldu.
)

:: --- node_modules kontrolu ---
if not exist "%FRONTEND_DIR%\node_modules" (
    echo [!] Frontend bagimliliklari kuruluyor...
    pushd "%FRONTEND_DIR%"
    npm install --silent
    popd
    echo [OK] Frontend bagimliliklari kuruldu.
)

:: --- Backend'i ayri pencerede baslat ---
echo  [1/2] Backend baslatiliyor (FastAPI - port 8000)...
set "BACKEND_CMD=cd /d %BACKEND_DIR% && %VENV_PYTHON% -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"
start "IGLO Backend" cmd /k "%BACKEND_CMD%"

:: 3 saniye bekle
timeout /t 3 /nobreak >nul

:: --- Frontend'i ayri pencerede baslat ---
echo  [2/2] Frontend baslatiliyor (Next.js - port 3000)...
set "FRONTEND_CMD=cd /d %FRONTEND_DIR% && npm run dev"
start "IGLO Frontend" cmd /k "%FRONTEND_CMD%"

echo.
echo  ==========================================
echo    Hazir! Tarayicida http://localhost:3000
echo    adresini ac.
echo  ==========================================
echo.
timeout /t 5 /nobreak >nul
start http://localhost:3000
