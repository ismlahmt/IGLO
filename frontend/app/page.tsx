"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cloud, Upload, RefreshCw, Settings, LogOut,
  Search, HardDrive, Film, Music, ImageIcon,
  FileText, Archive, FolderOpen, Loader2, X,
  Play, Download, Trash2, MoreHorizontal,
  CheckCircle, AlertCircle, ChevronRight
} from "lucide-react";
import { isAuthenticated, logout, listFiles, syncFiles, getStats, uploadFile, deleteFile, FileItem, getDownloadUrl } from "@/lib/api";
import VideoPlayer from "@/components/VideoPlayer";

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
  id: string; file: File; progress: number;
  status: "pending"|"uploading"|"done"|"error"; error?: string;
}

/* ── File card ────────────────────────────────── */
function FileCard({ file, index, onPlay, onDelete }: {
  file: FileItem; index: number;
  onPlay: (f: FileItem) => void;
  onDelete: (id: number) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cat = getCategory(file);
  const cfg = CAT_CONFIG[cat];
  const isMedia = ["video","audio"].includes(cat);

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
    if (!confirm(`"${file.name}" silinsin mi?`)) return;
    setDeleting(true);
    try { await deleteFile(file.message_id); onDelete(file.message_id); }
    catch { alert("Silme başarısız"); setDeleting(false); }
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
        style={{ background: `linear-gradient(135deg, ${cfg.bg}, transparent)` }}
        onClick={() => isMedia && onPlay(file)}
      >
        {/* Glow */}
        <div
          className="file-card-glow"
          style={{ background: `radial-gradient(ellipse at 50% 50%, ${cfg.color}20, transparent 60%)` }}
        />

        {/* Icon */}
        <div
          className="file-card-icon-wrap"
          style={{ background: cfg.bg, border: `1px solid ${cfg.color}30` }}
        >
          <cfg.Icon size={24} style={{ color: cfg.color }} />
        </div>

        {/* Category */}
        <div
          className="file-card-cat"
          style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}25` }}
        >
          {cfg.label}
        </div>

        {/* Actions */}
        <div className="file-card-actions">
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
  const [showUpload, setShowUpload] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [playingFile, setPlayingFile] = useState<FileItem | null>(null);
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

  async function processFiles(fileList: FileList | File[]) {
    const arr = Array.from(fileList);
    const items: UploadItem[] = arr.map(f => ({ id: crypto.randomUUID(), file: f, progress: 0, status: "pending" as const }));
    setUploads(prev => [...prev, ...items]);
    setShowUpload(true);

    for (const item of items) {
      updateUpload(item.id, { status: "uploading" });
      try {
        const result = await uploadFile(item.file, folder, pct => updateUpload(item.id, { progress: pct }));
        updateUpload(item.id, { status: "done", progress: 100 });
        setFiles(prev => [result, ...prev]);
        loadStats();
        setTimeout(() => setUploads(prev => prev.filter(u => u.id !== item.id)), 4000);
      } catch (e: unknown) {
        updateUpload(item.id, { status: "error", error: e instanceof Error ? e.message : "Hata" });
      }
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
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

          {/* Category chips (desktop) */}
          <div style={{ display: "flex", gap: 4, overflow: "hidden" }}>
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
              className="btn btn-secondary btn-icon"
              title="Senkronize"
            >
              <RefreshCw size={14} className={syncing ? "spin" : ""} />
            </button>
            <button
              id="upload-btn"
              onClick={() => setShowUpload(!showUpload)}
              className="btn btn-primary"
            >
              <Upload size={14} /> Yükle
            </button>
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

          {/* Upload panel */}
          <AnimatePresence>
            {showUpload && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 20 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                style={{ overflow: "hidden" }}
              >
                <div
                  className={`drop-zone ${dragging ? "over" : ""}`}
                  onClick={() => document.getElementById("file-input")?.click()}
                  style={{ marginBottom: uploads.length ? 12 : 0 }}
                >
                  <input
                    id="file-input"
                    type="file"
                    multiple
                    style={{ display: "none" }}
                    onChange={e => { if (e.target.files?.length) processFiles(e.target.files); e.target.value = ""; }}
                  />
                  <div className="drop-icon-wrap">
                    <Upload size={22} style={{ color: "var(--purple)" }} />
                  </div>
                  <p style={{ fontWeight: 700, fontSize: 14, color: "var(--text-1)", marginBottom: 4 }}>
                    Dosyaları sürükle veya tıkla
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text-3)" }}>
                    Her boyutta dosya • AES-256 şifreli yükleme
                  </p>
                </div>

                {/* Upload list */}
                <AnimatePresence>
                  {uploads.map(u => (
                    <motion.div
                      key={u.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      className="upload-item"
                      style={{ marginBottom: 6 }}
                    >
                      <div style={{ flexShrink: 0 }}>
                        {u.status === "uploading" && <Loader2 size={14} className="spin" style={{ color: "var(--purple)" }} />}
                        {u.status === "done" && <CheckCircle size={14} style={{ color: "var(--emerald)" }} />}
                        {u.status === "error" && <AlertCircle size={14} style={{ color: "var(--rose)" }} />}
                        {u.status === "pending" && <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid var(--border-default)" }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.file.name}</div>
                        {u.status === "uploading" && (
                          <div className="upload-progress">
                            <div className="upload-progress-fill" style={{ width: `${u.progress}%` }} />
                          </div>
                        )}
                        {u.status === "error" && <div style={{ fontSize: 11, color: "var(--rose)", marginTop: 2 }}>{u.error}</div>}
                      </div>
                      <span style={{ fontSize: 11, color: "var(--text-4)", flexShrink: 0 }}>{fmtSize(u.file.size)}</span>
                      {(u.status === "done" || u.status === "error") && (
                        <button onClick={() => setUploads(prev => prev.filter(x => x.id !== u.id))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", flexShrink: 0 }}>
                          <X size={13} />
                        </button>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
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
              <button onClick={() => setShowUpload(true)} className="btn btn-primary">
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
                  onDelete={id => { setFiles(prev => prev.filter(f => f.message_id !== id)); loadStats(); }}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Video player */}
      <AnimatePresence>
        {playingFile && <VideoPlayer file={playingFile} onClose={() => setPlayingFile(null)} />}
      </AnimatePresence>
    </div>
  );
}
