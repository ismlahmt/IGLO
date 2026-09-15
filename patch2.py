import os

with open('backend/services/telegram_service.py', 'r', encoding='utf-8') as f:
    code = f.read()

# I will replace stream_file_chunks completely.
import re

new_stream_logic = """
async def stream_file_chunks(
    message_id: int,
    start: int = 0,
    end: Optional[int] = None,
) -> AsyncGenerator[bytes, None]:
    client = await get_client()
    settings = get_settings()
    file_item = cache_service.get_file(message_id)

    if message_id not in _MSG_CACHE:
        _MSG_CACHE[message_id] = await client.get_messages(
            settings.telegram_channel_id, message_id
        )
    msg = _MSG_CACHE[message_id]

    file_size = file_item.size if file_item else 0
    if end is None:
        end = max(file_size - 1, 0)

    # Şifresiz dosya
    if not file_item or not file_item.encrypted:
        first_chunk = start // STREAM_CHUNK_SIZE
        last_chunk  = end   // STREAM_CHUNK_SIZE
        limit_chunks = last_chunk - first_chunk + 1
        
        chunk_idx = first_chunk
        async for chunk in client.stream_media(msg, offset=first_chunk, limit=limit_chunks):
            chunk_start = chunk_idx * STREAM_CHUNK_SIZE
            slice_start = max(0, start - chunk_start) if chunk_idx == first_chunk else 0
            slice_end   = min(len(chunk), end - chunk_start + 1) if chunk_idx == last_chunk else len(chunk)
            
            if slice_start < slice_end:
                yield chunk[slice_start:slice_end]
            chunk_idx += 1
        return

    # Şifreli dosya
    actual_start = start + 16
    actual_end   = end   + 16

    first_chunk = actual_start // STREAM_CHUNK_SIZE
    last_chunk  = actual_end   // STREAM_CHUNK_SIZE
    limit_chunks = last_chunk - first_chunk + 1

    nonce = b""
    if file_item.checksum and file_item.checksum.startswith("aes-ctr:"):
        try:
            nonce_b64 = file_item.checksum.split(":")[1]
            nonce = base64.b64decode(nonce_b64)
        except Exception:
            pass

    if not nonce:
        async for chunk0 in client.stream_media(msg, offset=0, limit=1):
            if len(chunk0) >= 16:
                nonce = chunk0[:16]
                nonce_b64 = base64.b64encode(nonce).decode()
                file_item.checksum = f"aes-ctr:{nonce_b64}:" + (file_item.checksum or "")
            break
            
    if not nonce or len(nonce) < 16:
        return

    decryptor, discard = crypto_service.get_seekable_decryptor(nonce, start)
    first_yield = True

    chunk_idx = first_chunk
    async for chunk in client.stream_media(msg, offset=first_chunk, limit=limit_chunks):
        chunk_start = chunk_idx * STREAM_CHUNK_SIZE
        
        slice_start = max(0, actual_start - chunk_start) if chunk_idx == first_chunk else 0
        slice_end   = min(len(chunk), actual_end - chunk_start + 1) if chunk_idx == last_chunk else len(chunk)

        if slice_start < slice_end:
            data_to_decrypt = chunk[slice_start:slice_end]
            decrypted = decryptor.update(data_to_decrypt)
            
            if first_yield:
                decrypted = decrypted[discard:]
                first_yield = False
                
            if decrypted:
                yield decrypted
                
        chunk_idx += 1
"""

# Find stream_file_chunks and replace up to # ── Delete
code = re.sub(
    r'async def stream_file_chunks\(.*?# ── Delete ─',
    new_stream_logic + '\n\n# ── Delete ─',
    code,
    flags=re.DOTALL
)

with open('backend/services/telegram_service.py', 'w', encoding='utf-8') as f:
    f.write(code)
