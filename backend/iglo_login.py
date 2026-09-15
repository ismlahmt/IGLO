import os
import asyncio
from pyrogram import Client
from dotenv import set_key, load_dotenv

async def main():
    # Mevcut api_id ve api_hash'i oku
    load_dotenv("backend/.env")
    api_id = os.environ.get("TELEGRAM_API_ID")
    api_hash = os.environ.get("TELEGRAM_API_HASH")
    
    if not api_id or not api_hash:
        print("HATA: backend/.env icinde TELEGRAM_API_ID ve TELEGRAM_API_HASH bulunamadi!")
        return

    print("Lutfen telefon numaranizi ve Telegram'dan gelen kodu girin.")
    
    # Yeni bir session olustur (in_memory)
    app = Client("yeni_oturum", api_id=int(api_id), api_hash=api_hash, in_memory=True)
    await app.start()
    
    # Session string'i al
    session_string = await app.export_session_string()
    
    # .env dosyasini guncelle
    set_key("backend/.env", "TELEGRAM_SESSION_STRING", session_string)
    
    print("\n✅ HARIKA! Yeni oturum anahtari otomatik olarak .env dosyasina kaydedildi.")
    print("Artik IGLO_BASLAT.bat ile sistemi acip Senkronize Et tusuna basabilirsin!")
    
    await app.stop()

if __name__ == "__main__":
    asyncio.run(main())
