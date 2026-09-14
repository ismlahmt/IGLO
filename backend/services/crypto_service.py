"""
Şifreleme Servisi — AES-256 (Fernet)
Dosyalar Telegram'a gönderilmeden önce şifrelenir,
indirilirken çözülür. Streaming'de chunk bazında çalışır.
"""
import io
import os
import base64
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.fernet import Fernet
from config import get_settings

CHUNK_SIZE = 1024 * 1024  # 1MB chunk

def get_raw_key() -> bytes:
    key_b64 = get_settings().encryption_key
    if not key_b64:
        raise ValueError("ENCRYPTION_KEY ayarlanmamış.")
    return base64.urlsafe_b64decode(key_b64.encode())

def encrypt_bytes(data: bytes) -> bytes:
    """Veriyi AES-CTR ile şifrele."""
    key = get_raw_key()
    nonce = os.urandom(16)
    cipher = Cipher(algorithms.AES(key), modes.CTR(nonce), backend=default_backend())
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(data) + encryptor.finalize()
    return nonce + ciphertext

def decrypt_bytes(data: bytes) -> bytes:
    """Şifrelenmiş veriyi AES-CTR ile çöz."""
    if len(data) < 16:
        return b""
    key = get_raw_key()
    nonce = data[:16]
    ciphertext = data[16:]
    cipher = Cipher(algorithms.AES(key), modes.CTR(nonce), backend=default_backend())
    decryptor = cipher.decryptor()
    return decryptor.update(ciphertext) + decryptor.finalize()

def get_seekable_decryptor(nonce: bytes, byte_offset: int):
    """
    Belirli bir byte_offset'ten başlayan şifre çözücü ve kullanılmayacak byte sayısını döndürür.
    AES-CTR streaming için gereklidir.
    """
    key = get_raw_key()
    block_offset = byte_offset // 16
    discard_bytes = byte_offset % 16
    
    nonce_int = int.from_bytes(nonce, 'big')
    new_nonce_int = (nonce_int + block_offset) % (2**128)
    new_nonce = new_nonce_int.to_bytes(16, 'big')
    
    cipher = Cipher(algorithms.AES(key), modes.CTR(new_nonce), backend=default_backend())
    return cipher.decryptor(), discard_bytes

def encrypt_stream(input_stream: io.IOBase) -> bytes:
    data = input_stream.read()
    return encrypt_bytes(data)

def decrypt_to_stream(encrypted_data: bytes) -> io.BytesIO:
    decrypted = decrypt_bytes(encrypted_data)
    return io.BytesIO(decrypted)

def generate_new_key() -> str:
    return Fernet.generate_key().decode()
