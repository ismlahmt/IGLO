import re

with open('backend/services/telegram_service.py', 'r', encoding='utf-8') as f:
    code = f.read()

code = re.sub(
    r'except Exception:\s+return b""\s+# Hata.*',
    r'except Exception as e:\n            import traceback\n            traceback.print_exc()\n            return b""',
    code
)

with open('backend/services/telegram_service.py', 'w', encoding='utf-8') as f:
    f.write(code)

with open('backend/routers/thumbnail.py', 'r', encoding='utf-8') as f:
    tcode = f.read()

tcode = re.sub(
    r'stream_url = f"http://localhost:\{port\}/api/stream/\{message_id\}\?token=\{token\}"',
    r'port = os.environ.get("PORT", settings.backend_port)\n    stream_url = f"http://127.0.0.1:{port}/api/stream/{message_id}?token={token}"',
    tcode
)

with open('backend/routers/thumbnail.py', 'w', encoding='utf-8') as f:
    f.write(tcode)
