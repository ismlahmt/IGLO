import os
import asyncio
from pathlib import Path
from typing import Optional

# Cache directory - configurable via env var
CACHE_DIR = os.environ.get("IGLO_CACHE_DIR", "/var/cache/iglo")
MAX_CACHE_GB = int(os.environ.get("IGLO_MAX_CACHE_GB", "150"))

# Ensure cache directory exists
os.makedirs(CACHE_DIR, exist_ok=True)

# Track files currently being cached (prevent duplicate downloads)
_caching_locks: dict[int, asyncio.Lock] = {}
_caching_done: set[int] = set()

def get_path(message_id: int) -> str:
    """Cache file path: /var/cache/iglo/14.dat"""
    return os.path.join(CACHE_DIR, f"{message_id}.dat")

def is_cached(message_id: int) -> bool:
    """Check if file is fully cached on disk."""
    return message_id in _caching_done or os.path.exists(get_path(message_id))

def touch(message_id: int):
    """Update access time for LRU tracking."""
    path = get_path(message_id)
    if os.path.exists(path):
        os.utime(path)

def remove(message_id: int):
    """Remove cached file (on delete)."""
    path = get_path(message_id)
    if os.path.exists(path):
        os.remove(path)
    _caching_done.discard(message_id)
    _caching_locks.pop(message_id, None)

def get_cache_size_bytes() -> int:
    """Total size of all cached files."""
    total = 0
    try:
        for f in os.listdir(CACHE_DIR):
            fp = os.path.join(CACHE_DIR, f)
            if os.path.isfile(fp):
                total += os.path.getsize(fp)
    except OSError:
        pass
    return total

async def evict_if_needed():
    """Delete oldest cached files if cache exceeds MAX_CACHE_GB."""
    max_bytes = MAX_CACHE_GB * 1024 * 1024 * 1024
    if get_cache_size_bytes() <= max_bytes:
        return
    
    files = []
    try:
        for f in os.listdir(CACHE_DIR):
            fp = os.path.join(CACHE_DIR, f)
            if os.path.isfile(fp):
                stat = os.stat(fp)
                files.append((fp, stat.st_atime, stat.st_size))
    except OSError:
        return
    
    # Sort by access time (oldest first)
    files.sort(key=lambda x: x[1])
    
    current_size = sum(f[2] for f in files)
    for fp, _, size in files:
        if current_size <= max_bytes:
            break
        try:
            os.remove(fp)
            current_size -= size
            # Also clean _caching_done
            try:
                mid = int(os.path.basename(fp).replace('.dat', ''))
                _caching_done.discard(mid)
            except ValueError:
                pass
        except OSError:
            continue

async def cache_file_from_telegram(message_id: int, download_client, msg, file_item, crypto_service) -> str:
    """
    Download file from Telegram, decrypt, write to disk.
    Uses asyncio.Lock to prevent duplicate downloads.
    Returns the cached file path.
    """
    path = get_path(message_id)
    
    # Already cached?
    if message_id in _caching_done and os.path.exists(path):
        touch(message_id)
        return path
    
    # Get or create lock for this file
    if message_id not in _caching_locks:
        _caching_locks[message_id] = asyncio.Lock()
    
    async with _caching_locks[message_id]:
        # Double-check after acquiring lock
        if message_id in _caching_done and os.path.exists(path):
            return path
        
        try:
            # Download and decrypt chunk by chunk to avoid OOM
            tmp_path = path + ".tmp"
            
            # Setup streaming decryptor if encrypted
            decryptor = None
            nonce = None
            is_encrypted = file_item and file_item.encrypted
            
            with open(tmp_path, 'wb') as f:
                async for chunk in download_client.stream_media(msg):
                    if not chunk:
                        continue
                        
                    if is_encrypted:
                        if nonce is None:
                            # First block contains nonce
                            if len(chunk) >= 16:
                                nonce = chunk[:16]
                                decryptor, _ = crypto_service.get_seekable_decryptor(nonce, 0)
                                decrypted = decryptor.update(chunk[16:])
                                if decrypted:
                                    f.write(decrypted)
                            else:
                                # Edge case: first chunk smaller than 16 bytes (highly unlikely)
                                pass
                        else:
                            decrypted = decryptor.update(chunk)
                            if decrypted:
                                f.write(decrypted)
                    else:
                        f.write(chunk)
            
            os.replace(tmp_path, path)  # Atomic rename
            
            _caching_done.add(message_id)
            _caching_locks.pop(message_id, None)
            
            # Evict old files if needed
            await evict_if_needed()
            
            return path
        except asyncio.CancelledError:
            # Cleanup partial file
            for p in [path + '.tmp', path]:
                if os.path.exists(p):
                    os.remove(p)
            raise
        except Exception as e:
            print(f'[disk_cache] Error caching #{message_id}: {e}')
            # Cleanup
            for p in [path + '.tmp']:
                if os.path.exists(p):
                    os.remove(p)
            raise

def init_cache():
    """Startup: scan existing cache files and populate _caching_done set."""
    try:
        for f in os.listdir(CACHE_DIR):
            if f.endswith('.dat'):
                try:
                    mid = int(f.replace('.dat', ''))
                    _caching_done.add(mid)
                except ValueError:
                    pass
    except OSError:
        pass

# Initialize on import
init_cache()
