import asyncio
from pyrogram import Client
from config import get_settings

async def main():
    settings = get_settings()
    client = Client(
        name="iglo_test",
        api_id=settings.telegram_api_id,
        api_hash=settings.telegram_api_hash,
        session_string=settings.telegram_session_string,
        in_memory=True
    )
    await client.start()
    try:
        msgs = []
        async for dialog in client.get_dialogs():
            if dialog.chat.id == settings.telegram_channel_id:
                async for msg in client.get_chat_history(settings.telegram_channel_id, limit=5):
                    if msg.document:
                        msgs.append(msg)
                break
        
        if msgs:
            msg = msgs[0]
            print(f"Downloading msg {msg.id}...")
            # Let's try downloading without file_name but with in_memory=True
            try:
                res = await client.download_media(msg, in_memory=True)
                print(f"Download 1 (in_memory=True, no file_name): {type(res)}")
            except Exception as e:
                print(f"Error 1: {type(e).__name__} - {str(e)}")
            
            # Let's try passing a string as file_name just to test if that's what it wants
            try:
                import io
                res2 = await client.download_media(msg, file_name="dummy", in_memory=True)
                print(f"Download 2 (file_name='dummy', in_memory=True): {type(res2)}")
            except Exception as e:
                print(f"Error 2: {type(e).__name__} - {str(e)}")
                
        else:
            print("No media msgs")
    except Exception as e:
        import traceback
        traceback.print_exc()
    await client.stop()

asyncio.run(main())
