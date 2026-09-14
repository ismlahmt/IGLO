import axios from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

// JWT token'ı her isteğe ekle
api.interceptors.request.use((config) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("iglo_token") : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 401 → login sayfasına yönlendir
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("iglo_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;

// ─── Auth ─────────────────────────────────────────────
export async function login(username: string, password: string) {
  const res = await api.post("/api/auth/login", { username, password });
  const token = res.data.access_token;
  localStorage.setItem("iglo_token", token);
  return token;
}

export function logout() {
  localStorage.removeItem("iglo_token");
  window.location.href = "/login";
}

export function isAuthenticated() {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem("iglo_token");
}

// ─── Files ────────────────────────────────────────────
export interface FileItem {
  message_id: number;
  name: string;
  folder: string;
  size: number;
  mime_type: string;
  date: string;
  encrypted: boolean;
  checksum?: string;
  file_category?: string;
}

export async function listFiles(params?: {
  folder?: string;
  category?: string;
  search?: string;
}): Promise<FileItem[]> {
  const res = await api.get("/api/files", { params });
  return res.data;
}

export async function uploadFile(
  file: File,
  folder: string = "/",
  onProgress?: (percent: number) => void
): Promise<FileItem> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  const res = await api.post("/api/files/upload", form, {
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return res.data.file;
}

export async function deleteFile(messageId: number): Promise<void> {
  await api.delete(`/api/files/${messageId}`);
}

export async function syncFiles(fullRefresh = false) {
  const res = await api.post("/api/files/sync", null, { params: { full_refresh: fullRefresh } });
  return res.data;
}

export async function getStats() {
  const res = await api.get("/api/files/stats");
  return res.data;
}

export function getStreamUrl(messageId: number): string {
  const token = typeof window !== "undefined" ? localStorage.getItem("iglo_token") : "";
  return `${API_BASE}/api/stream/${messageId}?token=${token}`;
}

export function getDownloadUrl(messageId: number): string {
  return `${API_BASE}/api/files/download/${messageId}`;
}

// ─── Migration ────────────────────────────────────────
export async function startMigration(newChannelId: number, newSessionString?: string) {
  const res = await api.post("/api/migrate/start", {
    new_channel_id: newChannelId,
    new_session_string: newSessionString,
  });
  return res.data;
}

export async function getMigrationStatus() {
  const res = await api.get("/api/migrate/status");
  return res.data;
}
