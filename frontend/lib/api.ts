import axios from "axios";

const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || `http://${host}:8000`;

const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
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
  onProgress?: (percent: number) => void,
  customName?: string,
  abortController?: AbortController
): Promise<FileItem> {
  const uploadId = crypto.randomUUID();
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  form.append("upload_id", uploadId);
  if (customName) {
    form.append("custom_name", customName);
  }

  let interval: ReturnType<typeof setInterval>;
  if (onProgress) {
    // Backend'in Telegram'a yüklemesini saniyede 1 kontrol ediyoruz.
    interval = setInterval(async () => {
      try {
        const pRes = await api.get(`/api/files/progress/${uploadId}`);
        if (pRes.data && pRes.data.progress) {
          onProgress(pRes.data.progress);
        }
      } catch (e) {
        // Hata yoksay
      }
    }, 1000);
  }

  try {
    const res = await api.post("/api/files/upload", form, {
      timeout: 0, // Sınır yok
      signal: abortController?.signal,
    });
    return res.data.file ?? res.data;
  } finally {
    if (interval) clearInterval(interval);
  }
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
  const token = typeof window !== "undefined" ? localStorage.getItem("iglo_token") : "";
  return `${API_BASE}/api/files/download/${messageId}?token=${token}`;
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
