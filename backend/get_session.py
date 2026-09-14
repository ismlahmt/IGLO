"""
IGLO -- Session String ve Kanal ID Alma Scripti
Calistir: python get_session.py
"""
import asyncio
import sys
import os

# Windows encoding fix
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

from pyrogram import Client
from dotenv import load_dotenv

load_dotenv()

API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
API_HASH = os.getenv("TELEGRAM_API_HASH", "")


async def main():
    print("=" * 50)
    print("  IGLO -- Telegram Kurulum Sihirbazi")
    print("=" * 50)
    print()
    print("Telegram'a giris yapilacak.")
    print("Telefon numarami +90 formatinda gir.")
    print("Ardindan Telegram'a gelen kodu gir.")
    print()

    async with Client(
        name="iglo_setup",
        api_id=API_ID,
        api_hash=API_HASH,
    ) as app:
        session = await app.export_session_string()

        print()
        print("Giris basarili!")
        print()
        print("-" * 50)
        print("SESSION STRING (.env dosyasina yapistir):")
        print("-" * 50)
        print(session)
        print("-" * 50)
        print()

        # Kanalları listele
        print("Kanallar listeleniyor...")
        print()
        async for dialog in app.get_dialogs():
            if dialog.chat.type.name in ("CHANNEL", "SUPERGROUP"):
                print(f"  Kanal Adi : {dialog.chat.title}")
                print(f"  Kanal ID  : {dialog.chat.id}")
                print()

        print("-" * 50)
        print("Yukaridaki listeden IGLO kanalinin ID'sini kopyala.")
        print("-" * 50)


if __name__ == "__main__":
    asyncio.run(main())
