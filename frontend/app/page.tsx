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
import { isAuthenticated, logout, listFiles, syncFiles, getStats, uploadFile, deleteFile, FileItem, getDownloadUrl, getThumbnailUrl } from "@/lib/api";
import VideoPlayer from "@/components/VideoPlayer";
import axios from "axios";

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
  const isMedia = ["video","audio"].includes(cat);
  const isVideo = cat === "video";
  const thumbUrl = isVideo ? getThumbnailUrl(file.message_id) : null;
  const showThumb = isVideo && !thumbError;

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
            <button className="file-card-action-btn play" onClick={(e) => { e.stopPropagation(); onPlay(file); }} title="Oynat">
              <Play size={12} fill="white" color="white" />
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
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null);
  const [fileToRename, setFileToRename] = useState<FileItem | null>(null);
  const [newName, setNewName] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [stats, setStats] = useState<{ total_files: number; total_size: number } | null>(null);
  const [folder, setFolder] = useState("/");
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

  function handleFilesSelected(fileList: FileList | File[]) {
    const arr = Array.from(fileList);
    const items: UploadItem[] = arr.map(f => ({ id: crypto.randomUUID(), file: f, customName: f.name, progress: 0, status: "pending" as const }));
    setUploads(prev => [...prev, ...items]);
  }

  async function startUploads() {
    const pendingItems = uploads.filter(u => u.status === "pending");
    for (const item of pendingItems) {
      const abortController = new AbortController();
      updateUpload(item.id, { status: "uploading", abortController });
      try {
        let finalName = item.customName.trim();
        const origExt = item.file.name.includes('.') ? item.file.name.split('.').pop() : null;
        if (origExt && !finalName.includes('.')) {
          finalName += `.${origExt}`;
        }
        
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
    if (e.dataTransfer.files.length) handleFilesSelected(e.dataTransfer.files);
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
            <button
              id="upload-btn"
              onClick={() => document.getElementById("main-file-input")?.click()}
              className="btn btn-primary topbar-upload"
            >
              <Upload size={14} /> Yükle
            </button>
            <input
              id="main-file-input"
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={e => { if (e.target.files?.length) handleFilesSelected(e.target.files); e.target.value = ""; }}
            />
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
                  onPlay={setPlayingFile}
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

        {/* Upload Manager (Floating Bottom Right) */}
      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            style={{
              position: "fixed",
              bottom: 24,
              right: 24,
              width: 360,
              maxHeight: 500,
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
            
            {/* Start Button */}
            {uploads.some(u => u.status === "pending") && (
              <div style={{ padding: "12px", borderTop: "1px solid var(--border-subtle)", background: "var(--bg-2)" }}>
                <button onClick={startUploads} className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
                  <Play size={14} fill="white" /> Tümünü Başlat
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
      <button
        className="fab-upload"
        onClick={() => document.getElementById("main-file-input")?.click()}
        aria-label="Dosya Yükle"
      >
        <Plus size={22} />
      </button>
    </div>
  );
}
