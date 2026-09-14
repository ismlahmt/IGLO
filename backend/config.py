from pydantic_settings import BaseSettings
from cryptography.fernet import Fernet
from functools import lru_cache
import os


class Settings(BaseSettings):
    # Telegram
    telegram_api_id: int = 0
    telegram_api_hash: str = ""
    telegram_channel_id: int = 0
    telegram_session_string: str = ""

    # Güvenlik
    admin_username: str = "admin"
    admin_password: str = "changeme123"
    jwt_secret: str = "change_this_secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24  # 24 saat
    encryption_key: str = ""

    # Sunucu
    backend_port: int = 8000
    frontend_url: str = "http://localhost:3000"
    allowed_origins: str = "*"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    def get_fernet(self) -> Fernet:
        """Şifreleme anahtarını döner, yoksa yeni oluşturur."""
        if not self.encryption_key:
            raise ValueError(
                "ENCRYPTION_KEY ayarlanmamış. "
                "Lütfen `python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"` "
                "çalıştırıp .env dosyasına ekleyin."
            )
        return Fernet(self.encryption_key.encode())


@lru_cache()
def get_settings() -> Settings:
    return Settings()
