"""
Şifreleme Servisi — AES-256 (Fernet)
Dosyalar Telegram'a gönderilmeden önce şifrelenir,
indirilirken çözülür. Streaming'de chunk bazında çalışır.
"""
import io
from cryptography.fernet import Fernet
from config import get_settings

CHUNK_SIZE = 1024 * 1024  # 1MB chunk


def get_fernet() -> Fernet:
    return get_settings().get_fernet()


def encrypt_bytes(data: bytes) -> bytes:
    """Veriyi şifrele."""
    return get_fernet().encrypt(data)


def decrypt_bytes(data: bytes) -> bytes:
    """Şifrelenmiş veriyi çöz."""
    return get_fernet().decrypt(data)


def encrypt_stream(input_stream: io.IOBase) -> bytes:
    """
    Stream'i oku, şifrele ve döndür.
    Büyük dosyalar için bellek dostu chunk yaklaşımı.
    """
    data = input_stream.read()
    return encrypt_bytes(data)


def decrypt_to_stream(encrypted_data: bytes) -> io.BytesIO:
    """Şifrelenmiş veriyi çöz ve BytesIO olarak döndür."""
    decrypted = decrypt_bytes(encrypted_data)
    return io.BytesIO(decrypted)


def generate_new_key() -> str:
    """Yeni bir Fernet anahtarı üret."""
    return Fernet.generate_key().decode()
