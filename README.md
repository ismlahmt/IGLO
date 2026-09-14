# 🧊 IGLO — Kişisel Telegram Cloud

Telegram'ı depolama katmanı olarak kullanan, AES-256 şifreli, PWA destekli kişisel cloud sistemi.

## Özellikler

- 📁 Sürükle-bırak dosya yükleme
- 🎬 Video streaming (tam indirme gerekmez)
- 🔐 AES-256 şifreleme (Telegram'dan bakıldığında anlamsız veri)
- 📱 PWA — telefon/tablete uygulama olarak kurulabilir
- 🔄 Kanal göç sistemi — başka kanala/hesaba taşıma
- 📂 Sanal klasör sistemi
- 🔑 JWT kimlik doğrulama

## Kurulum

### 1. Telegram API Bilgilerini Al

1. https://my.telegram.org → "API Development Tools"
2. Yeni uygulama oluştur → `api_id` ve `api_hash` al
3. Telegram'da yeni bir gizli kanal oluştur (private)

### 2. Backend Yapılandırması

```bash
cd backend
copy .env.example .env
# .env dosyasını düzenle (Telegram bilgileri, şifre vb.)
```

### 3. Şifreleme Anahtarı Oluştur

```bash
cd backend
venv\Scripts\python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Çıktıyı .env dosyasındaki ENCRYPTION_KEY= değerine yapıştır
```

### 4. Telegram Session String Al

```bash
cd backend
venv\Scripts\python -c "
from pyrogram import Client
import asyncio

async def main():
    async with Client('iglo_setup', api_id=YOUR_API_ID, api_hash='YOUR_API_HASH') as app:
        print(await app.export_session_string())

asyncio.run(main())
"
# Çıktıyı .env dosyasındaki TELEGRAM_SESSION_STRING= değerine yapıştır
```

### 5. Başlat

```bash
# Ana dizinde (IGLO/)
python start.py
```

Tarayıcı otomatik açılacak: http://localhost:3000

Varsayılan giriş: `admin` / `changeme123` (.env'den değiştir)

## .env Dosyası

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890
TELEGRAM_CHANNEL_ID=-1001234567890
TELEGRAM_SESSION_STRING=BQA...

ADMIN_USERNAME=admin
ADMIN_PASSWORD=güçlü_bir_şifre
JWT_SECRET=en_az_32_karakter_rastgele_string
ENCRYPTION_KEY=fernet_key_buraya

BACKEND_PORT=8000
FRONTEND_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000
```

## Proje Yapısı

```
IGLO/
├── backend/          # FastAPI + Pyrogram
├── frontend/         # Next.js + TypeScript
└── start.py          # Tek komutla başlatma
```

## Teknolojiler

- **Backend**: Python 3.12, FastAPI, Pyrogram
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, Framer Motion
- **Depolama**: Telegram (şifreli)
- **Şifreleme**: AES-256 (Fernet)
- **Auth**: JWT
