"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cloud, Upload, RefreshCw, Settings, LogOut,
  Search, HardDrive, Film, Music, ImageIcon,
  FileText, Archive, FolderOpen, Loader2, X,
  Play, Download, Trash2, MoreHorizontal,
  CheckCircle, AlertCircle, ChevronRight, Plus
} from "lucide-react";
import { isAuthenticated, logout, listFiles, syncFiles, getStats, uploadFile, deleteFile, FileItem, getDownloadUrl, getThumbnailUrl, getStreamUrl } from "@/lib/api";
import VideoPlayer from "@/components/VideoPlayer";
import axios from "axios";

/* HTTP ve HTTPS'de çalışan UUID üretici */
function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
}


/* ── helpers ──────────────────────────────────── */
function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
}
function getCategory(f: FileItem) {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4","mkv","avi","mov","webm","m4v"].includes(ext)) return "video";
  if (["mp3","flac","wav","ogg","aac","m4a"].includes(ext)) return "audio";
  if (["jpg","jpeg","png","gif","webp","svg","bmp"].includes(ext)) return "image";
  if (["pdf","doc","docx","txt","xls","xlsx","ppt"].includes(ext)) return "document";
  if (["zip","rar","7z","tar","gz"].includes(ext)) return "archive";
  return "other";
}

const CAT_CONFIG: Record<string, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  video:    { label: "Video",    color: "#6366f1", bg: "rgba(99,102,241,0.12)",  Icon: Film },
  audio:    { label: "Ses",      color: "#8b5cf6", bg: "rgba(139,92,246,0.12)", Icon: Music },
  image:    { label: "Görsel",   color: "#14b8a6", bg: "rgba(20,184,166,0.12)", Icon: ImageIcon },
  document: { label: "Belge",    color: "#f59e0b", bg: "rgba(245,158,11,0.12)", Icon: FileText },
  archive:  { label: "Arşiv",    color: "#f43f5e", bg: "rgba(244,63,94,0.12)",  Icon: Archive },
  other:    { label: "Diğer",    color: "#64748b", bg: "rgba(100,116,139,0.12)",Icon: Cloud },
};

const CATS = [
  { id: "", label: "Tümü", Icon: HardDrive },
  ...Object.entries(CAT_CONFIG).map(([id, v]) => ({ id, label: v.label, Icon: v.Icon })),
];

/* ── Upload state ─────────────────────────────── */
interface UploadItem {
  id: string; file: File; progress: number; customName: string;
  status: "pending"|"uploading"|"done"|"error"|"canceled"; error?: string; abortController?: AbortController;
}

/* ── Upload queue (önizleme modalı için) ─────── */
interface QueueItem {
  id: string;
  file: File;
  customName: string;
  previewUrl?: string; // image/video için object URL
}

/* ── File card ────────────────────────────────── */
function FileCard({ file, index, onPlay, onDeleteRequest, onRenameRequest }: {
  file: FileItem; index: number;
  onPlay: (f: FileItem) => void;
  onDeleteRequest: (f: FileItem) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cat = getCategory(file);
  const cfg = CAT_CONFIG[cat];
  const isVideo = cat === "video";
  const isImage = cat === "image";
  const isAudio = cat === "audio";
  const isMedia = isVideo || isImage || isAudio; // tüm medya türleri tıklanabilir
  const thumbUrl = isVideo ? getThumbnailUrl(file.message_id)
    : isImage ? getStreamUrl(file.message_id) // fotolar → doğrudan stream
    : null;
  const showThumb = (isVideo || isImage) && !thumbError;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    if (menu) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menu]);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setMenu(false);
    onDeleteRequest(file);
  }

  return (
    <motion.div
      className="file-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.025, duration: 0.22 }}
      layout
      style={{ opacity: deleting ? 0.4 : 1 }}
    >
      {/* Thumb */}
      <div
        className="file-card-thumb"
        style={{ background: showThumb && thumbLoaded ? "transparent" : `linear-gradient(135deg, ${cfg.bg}, transparent)` }}
        onClick={() => isMedia && onPlay(file)}
      >
        {/* Video thumbnail */}
        {thumbUrl && (
          <img
            src={thumbUrl}
            alt={file.name}
            onLoad={() => setThumbLoaded(true)}
            onError={() => setThumbError(true)}
            style={{
              position: "absolute", inset: 0,
              width: "100%", height: "100%",
              objectFit: "cover",
              opacity: thumbLoaded ? 1 : 0,
              transition: "opacity 0.3s",
            }}
          />
        )}

        {/* Thumbnail üzerinde gradient karartma */}
        {showThumb && thumbLoaded && (
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(to bottom, rgba(0,0,0,0.08), rgba(0,0,0,0.45))",
          }} />
        )}

        {/* Glow (thumbnail yokken) */}
        {(!showThumb || !thumbLoaded) && (
          <div
            className="file-card-glow"
            style={{ background: `radial-gradient(ellipse at 50% 50%, ${cfg.color}20, transparent 60%)` }}
          />
        )}

        {/* Icon (thumbnail yokken) */}
        {(!showThumb || !thumbLoaded) && (
          <div
            className="file-card-icon-wrap"
            style={{ background: cfg.bg, border: `1px solid ${cfg.color}30`, zIndex: 1 }}
          >
            <cfg.Icon size={24} style={{ color: cfg.color }} />
          </div>
        )}

        {/* Kategori badge */}
        <div
          className="file-card-cat"
          style={{
            background: showThumb && thumbLoaded ? "rgba(0,0,0,0.55)" : cfg.bg,
            color: showThumb && thumbLoaded ? "rgba(255,255,255,0.9)" : cfg.color,
            border: `1px solid ${showThumb && thumbLoaded ? "rgba(255,255,255,0.15)" : `${cfg.color}25`}`,
            backdropFilter: "blur(4px)",
            zIndex: 2,
          }}
        >
          {cfg.label}
        </div>

        {/* Actions */}
        <div className="file-card-actions" style={{ zIndex: 3 }}>
          {isMedia && (
            <button className="file-card-action-btn play"
              onClick={(e) => { e.stopPropagation(); onPlay(file); }}
              title={isImage ? "Görüntüle" : isAudio ? "Dinle" : "Oynat"}
            >
              {isImage
                ? <ImageIcon size={12} color="white" />
                : isAudio
                  ? <Music size={12} color="white" />
                  : <Play size={12} fill="white" color="white" />}
            </button>
          )}
          <a
            className="file-card-action-btn"
            href={getDownloadUrl(file.message_id)}
            download={file.name}
            onClick={(e) => e.stopPropagation()}
            title="İndir"
          >
            <Download size={12} />
          </a>
          <button
            className="file-card-action-btn delete"
            onClick={handleDelete}
            title="Sil"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="file-card-body">
        <div className="file-card-name" title={file.name}>{file.name}</div>
        <div className="file-card-meta">
          <span>{fmtSize(file.size)}</span>
          <span>{fmtDate(file.date)}</span>
        </div>
      </div>
    </motion.div>
  );
}

/* ── Main page ────────────────────────────────── */
export default function HomePage() {
  const router = useRouter();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [playingFile, setPlayingFile] = useState<FileItem | null>(null);
  const [viewingImage, setViewingImage] = useState<FileItem | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [playingAudio, setPlayingAudio] = useState<FileItem | null>(null);
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null);
  const [fileToRename, setFileToRename] = useState<FileItem | null>(null);
  const [newName, setNewName] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [stats, setStats] = useState<{ total_files: number; total_size: number } | null>(null);
  const [folder, setFolder] = useState("/");
  const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [showMobileUpload, setShowMobileUpload] = useState(false);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const mobileFileInputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/login"); return; }
    loadFiles();
    loadStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFiles(cat = category, q = search) {
    setLoading(true);
    try {
      const data = await listFiles({ category: cat || undefined, search: q || undefined });
      setFiles(data);
    } finally { setLoading(false); }
  }

  async function loadStats() {
    try { setStats(await getStats()); } catch { /* ignore */ }
  }

  async function handleSync() {
    setSyncing(true);
    try { await syncFiles(false); await loadFiles(); await loadStats(); }
    finally { setSyncing(false); }
  }

  function handleSearch(q: string) {
    setSearch(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadFiles(category, q), 350);
  }

  async function handleCatChange(cat: string) {
    setCategory(cat);
    await loadFiles(cat, search);
  }

  function updateUpload(id: string, patch: Partial<UploadItem>) {
    setUploads(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u));
  }

  // Dosyaları kuyruğa ekle (önizleme modalı için)
  function handleFilesQueued(fileList: FileList | File[]) {
    const arr = Array.from(fileList);
    const items: QueueItem[] = arr.map(f => ({
      id: genId(),
      file: f,
      customName: f.name,
      previewUrl: (f.type.startsWith("image/") || f.type.startsWith("video/"))
        ? URL.createObjectURL(f)
        : undefined,
    }));
    setUploadQueue(prev => [...prev, ...items]);
    setShowUploadMenu(false);
  }

  // Önizleme modalını kapat ve object URL'leri temizle
  function closeUploadQueue() {
    uploadQueue.forEach(q => { if (q.previewUrl) URL.revokeObjectURL(q.previewUrl); });
    setUploadQueue([]);
  }

  // Kuyruktan upload başlat
  function startQueuedUploads() {
    if (uploadQueue.length === 0) return;
    const items: UploadItem[] = uploadQueue.map(q => ({
      id: q.id, file: q.file, customName: q.customName, progress: 0, status: "pending" as const,
    }));
    uploadQueue.forEach(q => { if (q.previewUrl) URL.revokeObjectURL(q.previewUrl); });
    setUploadQueue([]);
    setUploads(prev => [...prev, ...items]);
    uploadItemsDirectly(items);
  }

  // items parametresiyle direkt çalışır — React state closure sorununu önler
  async function uploadItemsDirectly(items: UploadItem[]) {
    for (const item of items) {
      const abortController = new AbortController();
      updateUpload(item.id, { status: "uploading", abortController });
      try {
        let finalName = item.customName.trim();
        const origExt = item.file.name.includes(".") ? item.file.name.split(".").pop() : null;
        if (origExt && !finalName.includes(".")) finalName += `.${origExt}`;
        const result = await uploadFile(item.file, folder, pct => updateUpload(item.id, { progress: pct }), finalName, abortController);
        updateUpload(item.id, { status: "done", progress: 100 });
        setFiles(prev => [result, ...prev]);
        loadStats();
        setTimeout(() => setUploads(prev => prev.filter(u => u.id !== item.id)), 4000);
      } catch (e: unknown) {
        if (axios.isCancel(e)) {
          updateUpload(item.id, { status: "canceled" });
          setTimeout(() => setUploads(prev => prev.filter(u => u.id !== item.id)), 3000);
        } else {
          updateUpload(item.id, { status: "error", error: e instanceof Error ? e.message : "Hata" });
        }
      }
    }
  }

  function handleCancelOrRemove(item: UploadItem) {
    if (item.status === "uploading" && item.abortController) {
      item.abortController.abort();
    } else {
      setUploads(prev => prev.filter(x => x.id !== item.id));
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length) handleFilesQueued(e.dataTransfer.files);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  const filteredFiles = files.filter(f => folder === "/" ? true : f.folder === folder);
  const folders = Array.from(new Set(files.map(f => f.folder).filter(f => f !== "/")));

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">IG</div>
          <div>
            <div className="sidebar-logo-text">IGLO</div>
            <div className="sidebar-logo-sub">Kişisel Cloud</div>
          </div>
        </div>

        {/* Storage card */}
        {stats && (
          <div className="sidebar-storage-card">
            <div className="sidebar-storage-label">Depolama</div>
            <div className="sidebar-storage-value">{fmtSize(stats.total_size)}</div>
            <div className="sidebar-storage-sub">{stats.total_files} dosya • Telegram</div>
          </div>
        )}

        {/* Categories */}
        <div className="sidebar-section">
          <div className="sidebar-section-label">Kategoriler</div>
          {CATS.map(({ id, label, Icon }) => (
            <button
              key={id}
              id={`cat-${id || "all"}`}
              onClick={() => handleCatChange(id)}
              className={`sidebar-item ${category === id ? "active" : ""}`}
              style={{ width: "100%", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
            >
              <Icon size={15} />
              {label}
              {category === id && files.length > 0 && (
                <span className="sidebar-badge">{filteredFiles.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Folders */}
        {folders.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-label">Klasörler</div>
            <button
              onClick={() => setFolder("/")}
              className={`sidebar-item ${folder === "/" ? "active" : ""}`}
              style={{ width: "100%", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
            >
              <FolderOpen size={15} /> Kök
            </button>
            {folders.map(f => (
              <button
                key={f}
                onClick={() => setFolder(f)}
                className={`sidebar-item ${folder === f ? "active" : ""}`}
                style={{ width: "100%", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", paddingLeft: 20 }}
              >
                <ChevronRight size={11} style={{ opacity: 0.4 }} />
                <FolderOpen size={14} />
                <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.split("/").filter(Boolean).pop()}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Bottom nav */}
        <div className="sidebar-bottom">
          <button
            id="nav-settings"
            onClick={() => router.push("/settings")}
            className="sidebar-item"
            style={{ width: "100%", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
          >
            <Settings size={15} /> Ayarlar
          </button>
          <button
            id="nav-logout"
            onClick={logout}
            className="sidebar-item"
            style={{ width: "100%", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: "var(--rose)" }}
          >
            <LogOut size={15} /> Çıkış
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main">
        {/* Topbar */}
        <div className="topbar">
          {/* Search */}
          <div className="search-wrap">
            <Search size={14} />
            <input
              id="search-input"
              className="search-input"
              placeholder="Dosya ara..."
              value={search}
              onChange={e => handleSearch(e.target.value)}
            />
          </div>

          {/* Category chips (masaüstü — mobilde gizlenir, bottom nav kullanılır) */}
          <div className="topbar-cats" style={{ display: "flex", gap: 4, overflow: "hidden" }}>
            {CATS.slice(0, 5).map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => handleCatChange(id)}
                className={`cat-chip ${category === id ? "active" : ""}`}
                style={{ background: "none", border: "1px solid transparent", fontFamily: "inherit", cursor: "pointer" }}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <button
              id="sync-btn"
              onClick={handleSync}
              disabled={syncing}
              className="btn btn-secondary btn-icon topbar-sync"
              title="Senkronize"
            >
              <RefreshCw size={14} className={syncing ? "spin" : ""} />
            </button>

            {/* Yükle butonu + popup menü */}
            <div ref={uploadMenuRef} style={{ position: "relative" }}>
              <button
                id="upload-btn"
                onClick={() => setShowUploadMenu(v => !v)}
                className="btn btn-primary topbar-upload"
              >
                <Upload size={14} /> Yükle
              </button>

              <AnimatePresence>
                {showUploadMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.95 }}
                    transition={{ duration: 0.12 }}
                    style={{
                      position: "absolute", top: "calc(100% + 8px)", right: 0,
                      background: "var(--bg-1, #1e1e2e)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 14, padding: "6px",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                      zIndex: 200, minWidth: 200,
                    }}
                  >
                    {/* Fotoğraf / Video */}
                    <button
                      onClick={() => document.getElementById("input-media")?.click()}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        width: "100%", padding: "10px 12px", background: "none",
                        border: "none", borderRadius: 10, cursor: "pointer",
                        color: "var(--text-1, #fff)", fontFamily: "inherit",
                        fontSize: 14, fontWeight: 500,
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: "rgba(99,102,241,0.18)",
                        display: "flex", alignItems: "center", justifyContent: "center"
                      }}>
                        <ImageIcon size={18} style={{ color: "#6366f1" }} />
                      </div>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Fotoğraf veya Video</div>
                        <div style={{ fontSize: 11, color: "var(--text-3, #888)", marginTop: 1 }}>Görsel ve video dosyaları</div>
                      </div>
                    </button>

                    {/* Belge */}
                    <button
                      onClick={() => document.getElementById("input-document")?.click()}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        width: "100%", padding: "10px 12px", background: "none",
                        border: "none", borderRadius: 10, cursor: "pointer",
                        color: "var(--text-1, #fff)", fontFamily: "inherit",
                        fontSize: 14, fontWeight: 500,
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: "rgba(245,158,11,0.18)",
                        display: "flex", alignItems: "center", justifyContent: "center"
                      }}>
                        <FileText size={18} style={{ color: "#f59e0b" }} />
                      </div>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Belge</div>
                        <div style={{ fontSize: 11, color: "var(--text-3, #888)", marginTop: 1 }}>Her türlü dosya</div>
                      </div>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Gizli file input'lar */}
            <input id="input-media" type="file" multiple accept="image/*,video/*,audio/*" style={{ display: "none" }}
              onChange={e => { if (e.target.files?.length) handleFilesQueued(e.target.files); e.target.value = ""; }} />
            <input id="input-document" type="file" multiple style={{ display: "none" }}
              onChange={e => { if (e.target.files?.length) handleFilesQueued(e.target.files); e.target.value = ""; }} />
          </div>
        </div>

        {/* Content */}
        <div
          className="content"
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{ position: "relative" }}
        >
          {/* Full-screen drag overlay */}
          <AnimatePresence>
            {dragging && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(99,102,241,0.08)",
                  border: "2px dashed rgba(99,102,241,0.5)",
                  borderRadius: 20,
                  zIndex: 40,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backdropFilter: "blur(4px)",
                  pointerEvents: "none",
                }}
              >
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>📥</div>
                  <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text-1)" }}>Bırak!</p>
                  <p style={{ fontSize: 14, color: "var(--text-3)", marginTop: 4 }}>Dosyalar yüklenecek</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* File grid header */}
          <div className="page-heading">
            <div>
              <span className="page-title">
                {CATS.find(c => c.id === category)?.label ?? "Tüm Dosyalar"}
              </span>
              <span className="page-count">({filteredFiles.length})</span>
            </div>
          </div>

          {/* Files */}
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 12 }}>
              <Loader2 size={28} className="spin" style={{ color: "var(--purple)" }} />
              <p style={{ fontSize: 13, color: "var(--text-3)" }}>Dosyalar yükleniyor...</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <Cloud size={30} style={{ color: "var(--text-4)" }} />
              </div>
              <p className="empty-title">Henüz dosya yok</p>
              <p className="empty-desc">
                Dosyalarını yüklemek için sürükle-bırak kullan veya yükle butonuna tıkla.
              </p>
              <button onClick={() => document.getElementById("main-file-input")?.click()} className="btn btn-primary">
                <Upload size={14} /> İlk Dosyayı Yükle
              </button>
            </div>
          ) : (
            <div className="file-grid">
              {filteredFiles.map((file, i) => (
                <FileCard
                  key={file.message_id}
                  file={file}
                  index={i}
                  onPlay={(f) => {
                  const c = getCategory(f);
                  if (c === "video") setPlayingFile(f);
                  else if (c === "image") setViewingImage(f);
                  else if (c === "audio") setPlayingAudio(f);
                }}
                  onDeleteRequest={setFileToDelete}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      
        {/* Rename Modal */}
        <AnimatePresence>
          {fileToRename && (
            <motion.div
              className="modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isRenaming && setFileToRename(null)}
            >
              <motion.div
                className="modal-content"
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                onClick={e => e.stopPropagation()}
                style={{ padding: 24, maxWidth: 380, width: "100%" }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)", marginBottom: 16 }}>İsim Değiştir</h3>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={isRenaming}
                  className="input-field"
                  style={{ width: "100%", marginBottom: 20 }}
                  autoFocus
                />
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => setFileToRename(null)}
                    disabled={isRenaming}
                  >
                    İptal
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    disabled={isRenaming || !newName.trim() || newName.trim() === fileToRename.name}
                    onClick={async () => {
                      setIsRenaming(true);
                      try {
                        const token = localStorage.getItem("iglo_token");
                        const res = await fetch(`/api/files/${fileToRename.message_id}/rename`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                          body: JSON.stringify({ new_name: newName.trim() })
                        });
                        if (!res.ok) throw new Error();
                        
                        setFiles(prev => prev.map(f => f.message_id === fileToRename.message_id ? { ...f, name: newName.trim() } : f));
                        setFileToRename(null);
                      } catch {
                        alert("İsim değiştirilemedi.");
                      } finally {
                        setIsRenaming(false);
                      }
                    }}
                  >
                    {isRenaming ? "Kaydediliyor..." : "Kaydet"}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Upload Queue Modal (Telegram-style önizleme) ── */}
      <AnimatePresence>
        {uploadQueue.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
              backdropFilter: "blur(6px)", zIndex: 300,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
            }}
            onClick={closeUploadQueue}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              onClick={e => e.stopPropagation()}
              style={{
                background: "var(--bg-1, #1e1e2e)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 20, width: "100%", maxWidth: 500,
                maxHeight: "85vh", display: "flex", flexDirection: "column",
                boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
                overflow: "hidden",
              }}
            >
              {/* Modal Header */}
              <div style={{
                padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 10,
                    background: "rgba(99,102,241,0.2)",
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}>
                    <Upload size={16} style={{ color: "#6366f1" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1, #fff)" }}>
                      Dosya Yükle
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-3, #888)", marginTop: 1 }}>
                      {uploadQueue.length} dosya seçildi · {folder === "/" ? "Kök" : folder}
                    </div>
                  </div>
                </div>
                <button
                  onClick={closeUploadQueue}
                  style={{
                    width: 32, height: 32, borderRadius: "50%", border: "none",
                    background: "rgba(255,255,255,0.07)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--text-2, #aaa)",
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* File List */}
              <div style={{ overflowY: "auto", flex: 1, padding: "12px" }}>
                {uploadQueue.map((item, idx) => {
                  const ext = item.file.name.split(".").pop()?.toLowerCase() ?? "";
                  const isImg = item.file.type.startsWith("image/");
                  const isVid = item.file.type.startsWith("video/");
                  const cat = ["mp4","mkv","avi","mov","webm"].includes(ext) ? "video"
                    : ["jpg","jpeg","png","gif","webp","svg"].includes(ext) ? "image"
                    : ["mp3","flac","wav","ogg"].includes(ext) ? "audio"
                    : ["pdf","doc","docx","txt"].includes(ext) ? "document"
                    : "other";
                  const catColors: Record<string, {bg: string, color: string, Icon: React.ElementType}> = {
                    video:    { bg: "rgba(99,102,241,0.2)",  color: "#6366f1", Icon: Film },
                    image:    { bg: "rgba(20,184,166,0.2)",  color: "#14b8a6", Icon: ImageIcon },
                    audio:    { bg: "rgba(139,92,246,0.2)",  color: "#8b5cf6", Icon: Music },
                    document: { bg: "rgba(245,158,11,0.2)",  color: "#f59e0b", Icon: FileText },
                    other:    { bg: "rgba(100,116,139,0.2)", color: "#64748b", Icon: Archive },
                  };
                  const cfg = catColors[cat] ?? catColors.other;
                  const CatIcon = cfg.Icon;

                  return (
                    <div key={item.id} style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px", marginBottom: 8,
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)",
                    }}>
                      {/* Thumbnail */}
                      <div style={{
                        width: 56, height: 56, borderRadius: 10, flexShrink: 0, overflow: "hidden",
                        background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center"
                      }}>
                        {(isImg || isVid) && item.previewUrl ? (
                          isImg
                            ? <img src={item.previewUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                            : <video src={item.previewUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
                        ) : (
                          <CatIcon size={22} style={{ color: cfg.color }} />
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <input
                          type="text"
                          value={item.customName}
                          onChange={e => setUploadQueue(prev => prev.map((q, i) => i === idx ? { ...q, customName: e.target.value } : q))}
                          placeholder="Dosya adı..."
                          style={{
                            width: "100%", background: "rgba(0,0,0,0.25)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 8, padding: "6px 10px",
                            fontSize: 13, fontWeight: 500, color: "var(--text-1, #fff)",
                            outline: "none", fontFamily: "inherit",
                            transition: "border-color 0.15s",
                          }}
                          onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.6)")}
                          onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
                        />
                        <div style={{ fontSize: 11, color: "var(--text-3, #888)", marginTop: 4 }}>
                          {fmtSize(item.file.size)} · {item.file.type || "bilinmeyen tür"}
                        </div>
                      </div>

                      {/* Remove */}
                      <button
                        onClick={() => {
                          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
                          setUploadQueue(prev => prev.filter((_, i) => i !== idx));
                        }}
                        style={{
                          width: 30, height: 30, borderRadius: "50%", border: "none",
                          background: "rgba(244,63,94,0.15)", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#f43f5e", flexShrink: 0,
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div style={{
                padding: "12px 16px",
                borderTop: "1px solid rgba(255,255,255,0.07)",
                background: "rgba(0,0,0,0.15)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <button
                  onClick={closeUploadQueue}
                  style={{
                    padding: "10px 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.05)", cursor: "pointer",
                    color: "var(--text-2, #ccc)", fontFamily: "inherit", fontSize: 14, fontWeight: 500,
                  }}
                >
                  İptal
                </button>
                <button
                  onClick={startQueuedUploads}
                  disabled={uploadQueue.length === 0}
                  style={{
                    flex: 1, padding: "10px 18px", borderRadius: 12, border: "none",
                    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                    cursor: "pointer", color: "#fff", fontFamily: "inherit",
                    fontSize: 14, fontWeight: 600,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    boxShadow: "0 4px 16px rgba(99,102,241,0.4)",
                  }}
                >
                  <Upload size={15} />
                  Yükle · {uploadQueue.length} dosya
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload Manager (Floating Bottom Right) */}
      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            style={{
              position: "fixed",
              bottom: "calc(24px + var(--bottom-nav-h, 0px))",
              right: 24,
              width: 360,
              maxWidth: "calc(100vw - 48px)",
              maxHeight: 420,
              background: "var(--bg-1)",
              border: "1px solid var(--border-default)",
              borderRadius: 16,
              boxShadow: "0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
              zIndex: 50,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden"
            }}
          >
            {/* Header */}
            <div style={{ padding: "12px 16px", background: "var(--bg-2)", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                Yüklemeler ({uploads.filter(u => u.status === 'done').length}/{uploads.length})
              </div>
              <button onClick={() => setUploads(uploads.filter(u => u.status !== 'done' && u.status !== 'canceled'))} style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", fontSize: 12 }}>
                Temizle
              </button>
            </div>
            
            {/* List */}
            <div style={{ padding: "8px", overflowY: "auto", flex: 1, maxHeight: 380 }}>
              <AnimatePresence>
                {uploads.map(u => (
                  <motion.div
                    key={u.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    style={{
                      background: "var(--bg-2)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 12,
                      padding: "10px 12px",
                      marginBottom: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 12
                    }}
                  >
                     {/* Icon */}
                     <div style={{ flexShrink: 0 }}>
                        {u.status === "uploading" && <Loader2 size={16} className="spin" style={{ color: "var(--purple)" }} />}
                        {u.status === "done" && <CheckCircle size={16} style={{ color: "var(--emerald)" }} />}
                        {u.status === "error" && <AlertCircle size={16} style={{ color: "var(--rose)" }} />}
                        {u.status === "canceled" && <AlertCircle size={16} style={{ color: "var(--text-4)" }} />}
                        {u.status === "pending" && <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid var(--border-default)" }} />}
                     </div>

                     {/* Info */}
                     <div style={{ flex: 1, minWidth: 0 }}>
                        {u.status === "pending" ? (
                          <input 
                            type="text" 
                            value={u.customName}
                            onChange={(e) => updateUpload(u.id, { customName: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                            style={{ 
                              width: "100%", background: "rgba(0,0,0,0.2)", border: "1px solid var(--border-subtle)", 
                              borderRadius: 4, padding: "2px 6px", fontSize: 12, color: "var(--text-1)", outline: "none" 
                            }}
                          />
                        ) : (
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {u.customName}
                          </div>
                        )}
                        
                        {u.status === "uploading" && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                            <div style={{ flex: 1, height: 4, background: "var(--border-subtle)", borderRadius: 99, overflow: "hidden" }}>
                              <div style={{ width: `${u.progress}%`, height: "100%", background: "var(--purple)", transition: "width 0.2s" }} />
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--purple)" }}>%{u.progress}</span>
                          </div>
                        )}
                        
                        {u.status === "error" && <div style={{ fontSize: 11, color: "var(--rose)", marginTop: 2 }}>{u.error}</div>}
                        {u.status === "canceled" && <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 2 }}>İptal edildi</div>}
                     </div>

                     {/* Actions */}
                     <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                       {(u.status === "pending" || u.status === "uploading" || u.status === "error" || u.status === "canceled" || u.status === "done") && (
                         <button 
                           onClick={(e) => { e.stopPropagation(); handleCancelOrRemove(u); }}
                           style={{ background: "rgba(255,255,255,0.05)", border: "none", padding: 6, borderRadius: 6, cursor: "pointer", color: "var(--text-2)" }}
                           title={u.status === "uploading" ? "İptal" : "Kaldır"}
                         >
                           <X size={14} />
                         </button>
                       )}
                     </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            
            {/* Tüm uploadlar bitince paneli kapat butonu */}
            {uploads.length > 0 && uploads.every(u => u.status === "done" || u.status === "error" || u.status === "canceled") && (
              <div style={{ padding: "12px", borderTop: "1px solid var(--border-subtle)", background: "var(--bg-2)" }}>
                <button onClick={() => setUploads([])} className="btn btn-secondary" style={{ width: "100%", justifyContent: "center" }}>
                  <X size={14} /> Kapat
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Video player */}
      <AnimatePresence>
        {playingFile && <VideoPlayer file={playingFile} onClose={() => setPlayingFile(null)} />}
      </AnimatePresence>

      {/* ── Image Viewer ── */}
      <AnimatePresence>
        {viewingImage && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => { setViewingImage(null); setIsZoomed(false); }}
            style={{
              position: "fixed", inset: 0, zIndex: 400,
              background: "rgba(0,0,0,0.92)", backdropFilter: "blur(12px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 16, overflow: isZoomed ? "auto" : "hidden",
            }}
          >
            {/* Close */}
            <button
              onClick={() => { setViewingImage(null); setIsZoomed(false); }}
              style={{
                position: "absolute", top: 20, right: 20,
                width: 40, height: 40, borderRadius: "50%", border: "none",
                background: "rgba(255,255,255,0.1)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", backdropFilter: "blur(4px)", zIndex: 1,
              }}
            >
              <X size={20} />
            </button>

            {/* Download */}
            <a
              href={getDownloadUrl(viewingImage.message_id)}
              download={viewingImage.name}
              onClick={e => e.stopPropagation()}
              style={{
                position: "absolute", top: 20, right: 70,
                width: 40, height: 40, borderRadius: "50%",
                background: "rgba(255,255,255,0.1)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", backdropFilter: "blur(4px)", zIndex: 1,
                textDecoration: "none",
              }}
            >
              <Download size={18} />
            </a>

            {/* Image */}
            <motion.img
              src={getStreamUrl(viewingImage.message_id)}
              alt={viewingImage.name}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: isZoomed ? 2 : 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={e => {
                e.stopPropagation();
                setIsZoomed(!isZoomed);
              }}
              style={{
                maxWidth: "100%", maxHeight: "90vh",
                objectFit: "contain", borderRadius: 12,
                boxShadow: "0 32px 80px rgba(0,0,0,0.8)",
                userSelect: "none", cursor: isZoomed ? "zoom-out" : "zoom-in",
                transformOrigin: "center center",
              }}
            />

            {/* Filename */}
            <div style={{
              position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
              padding: "8px 16px", borderRadius: 99,
              fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: 500,
              maxWidth: "80vw", textAlign: "center", whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {viewingImage.name} · {fmtSize(viewingImage.size)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Audio Player ── */}
      <AnimatePresence>
        {playingAudio && (
          <motion.div
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            style={{
              position: "fixed",
              bottom: "calc(24px + var(--bottom-nav-h, 0px))",
              left: "50%", transform: "translateX(-50%)",
              width: "min(480px, calc(100vw - 32px))",
              background: "rgba(17,17,27,0.96)", backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 20, padding: "16px 20px",
              boxShadow: "0 16px 60px rgba(0,0,0,0.6)",
              zIndex: 400,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {/* Music icon */}
              <div style={{
                width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                background: "rgba(139,92,246,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Music size={22} style={{ color: "#8b5cf6" }} />
              </div>

              {/* Info + audio */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: "#fff",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  marginBottom: 6,
                }}>
                  {playingAudio.name}
                </div>
                <audio
                  src={getStreamUrl(playingAudio.message_id)}
                  controls
                  autoPlay
                  style={{ width: "100%", height: 32, outline: "none" }}
                />
              </div>

              {/* Close */}
              <button
                onClick={() => setPlayingAudio(null)}
                style={{
                  width: 32, height: 32, borderRadius: "50%", border: "none",
                  background: "rgba(255,255,255,0.08)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "rgba(255,255,255,0.7)", flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {fileToDelete && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !isDeleting && setFileToDelete(null)}
          >
            <motion.div
              className="modal-content"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              onClick={e => e.stopPropagation()}
              style={{ padding: 24, maxWidth: 380, textAlign: "center" }}
            >
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--rose-dim)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <Trash2 size={24} style={{ color: "var(--rose)" }} />
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)", marginBottom: 8 }}>
                Dosyayı Sil
              </h3>
              <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 24 }}>
                <span style={{ color: "var(--text-2)", fontWeight: 500 }}>"{fileToDelete.name}"</span> kalıcı olarak silinecek. Bu işlem geri alınamaz. Devam etmek istiyor musun?
              </p>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => !isDeleting && setFileToDelete(null)}
                >
                  İptal
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, background: "var(--rose)", borderColor: "var(--rose)" }}
                  onClick={async () => {
                    const id = fileToDelete.message_id;
                    setFileToDelete(null);
                    try {
                      await deleteFile(id);
                      setFiles(prev => prev.filter(f => f.message_id !== id));
                      loadStats();
                    } catch {
                      alert("Silme işlemi başarısız oldu.");
                    }
                  }}
                >
                  Evet, Sil
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom Navigation — sadece mobilde görünür ── */}
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {[
            { id: "",         label: "Tümü",   Icon: HardDrive },
            { id: "video",    label: "Video",   Icon: Film },
            { id: "image",    label: "Görsel",  Icon: ImageIcon },
            { id: "audio",    label: "Ses",     Icon: Music },
            { id: "document", label: "Belge",   Icon: FileText },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => handleCatChange(id)}
              className={`bottom-nav-item ${category === id ? "active" : ""}`}
            >
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* ── FAB — mobil yükleme butonu ── */}
      {/* Hidden file inputs for FAB */}
      <input
        ref={mobileFileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={e => { if (e.target.files?.length) { handleFilesQueued(e.target.files); e.target.value = ""; } }}
      />
      <button
        className="fab-upload"
        onClick={() => mobileFileInputRef.current?.click()}
        aria-label="Dosya Yükle"
      >
        <Plus size={22} />
      </button>

      {/* ── CSS variable for bottom nav height ── */}
      <style>{`
        @media (max-width: 768px) {
          :root { --bottom-nav-h: 68px; }
        }
      `}</style>
    </div>
  );
}
