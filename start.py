"""
IGLO Başlatma Scripti
Tek komutla hem backend hem frontend'i başlatır.
Kullanım: python start.py
"""
import subprocess
import sys
import os
import time
import signal
import webbrowser
from pathlib import Path

BASE_DIR = Path(__file__).parent
BACKEND_DIR = BASE_DIR / "backend"
FRONTEND_DIR = BASE_DIR / "frontend"

processes = []


def cleanup(signum=None, frame=None):
    print("\n🛑 IGLO kapatılıyor...")
    for p in processes:
        try:
            p.terminate()
        except Exception:
            pass
    sys.exit(0)


signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)


def check_env():
    env_file = BACKEND_DIR / ".env"
    if not env_file.exists():
        print("⚠️  .env dosyası bulunamadı!")
        print(f"   {BACKEND_DIR / '.env.example'} dosyasını kopyalayıp düzenleyin:")
        print(f"   copy backend\\.env.example backend\\.env")
        sys.exit(1)


def start_backend():
    print("🔧 Backend başlatılıyor...")
    p = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"],
        cwd=BACKEND_DIR,
        env={**os.environ, "PYTHONPATH": str(BACKEND_DIR)},
    )
    processes.append(p)
    return p


def start_frontend():
    print("🎨 Frontend başlatılıyor...")
    # Production build varsa serve et, yoksa dev modunda çalıştır
    build_dir = FRONTEND_DIR / ".next"
    if build_dir.exists():
        p = subprocess.Popen(
            ["npm", "run", "start"],
            cwd=FRONTEND_DIR,
            shell=True,
        )
    else:
        p = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd=FRONTEND_DIR,
            shell=True,
        )
    processes.append(p)
    return p


def main():
    print("=" * 50)
    print("  🧊 IGLO — Kişisel Telegram Cloud")
    print("=" * 50)

    check_env()

    backend_proc = start_backend()
    frontend_proc = start_frontend()

    # Biraz bekle, sonra tarayıcıyı aç
    time.sleep(4)
    print("\n✅ IGLO hazır!")
    print("   🌐 Arayüz: http://localhost:3000")
    print("   📡 API:    http://localhost:8000/api/docs")
    print("   Kapatmak için: Ctrl+C\n")

    webbrowser.open("http://localhost:3000")

    # Her iki process'i bekle
    try:
        while True:
            if backend_proc.poll() is not None:
                print("⚠️  Backend durdu!")
                break
            if frontend_proc.poll() is not None:
                print("⚠️  Frontend durdu!")
                break
            time.sleep(2)
    except KeyboardInterrupt:
        pass

    cleanup()


if __name__ == "__main__":
    main()
