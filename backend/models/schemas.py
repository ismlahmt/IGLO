from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class FileItem(BaseModel):
    message_id: int
    name: str
    folder: str = "/"
    size: int
    mime_type: str
    date: datetime
    encrypted: bool = True
    checksum: Optional[str] = None
    thumbnail_message_id: Optional[int] = None

    @property
    def extension(self) -> str:
        return self.name.rsplit(".", 1)[-1].lower() if "." in self.name else ""

    @property
    def file_category(self) -> str:
        ext = self.extension
        if ext in {"mp4", "mkv", "avi", "mov", "webm", "m4v"}:
            return "video"
        if ext in {"mp3", "flac", "wav", "ogg", "aac", "m4a"}:
            return "audio"
        if ext in {"jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"}:
            return "image"
        if ext in {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"}:
            return "document"
        if ext in {"zip", "rar", "7z", "tar", "gz"}:
            return "archive"
        return "other"


class FolderItem(BaseModel):
    path: str
    name: str
    file_count: int = 0


class UploadResponse(BaseModel):
    success: bool
    file: Optional[FileItem] = None
    message: str = ""


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MigrateRequest(BaseModel):
    new_channel_id: int
    new_session_string: Optional[str] = None  # Farklı hesap için


class MigrateStatus(BaseModel):
    status: str  # "idle", "running", "done", "error"
    total: int = 0
    transferred: int = 0
    current_file: str = ""
    error: Optional[str] = None


class CacheStats(BaseModel):
    total_files: int
    total_size: int
    last_updated: Optional[datetime] = None
    last_message_id: int = 0


class SettingsUpdate(BaseModel):
    telegram_channel_id: Optional[int] = None
    admin_username: Optional[str] = None
    admin_password: Optional[str] = None
    allowed_origins: Optional[str] = None
