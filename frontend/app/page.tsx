"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cloud, Upload, RefreshCw, Settings, LogOut,
  Search, LayoutGrid, List, Filter, HardDrive,
  Film, Music, Image, FileText, Archive, FolderOpen,
  ChevronRight, Loader2
} from "lucide-react";
import { isAuthenticated, logout, listFiles, syncFiles, getStats, FileItem } from "@/lib/api";
import FileCard from "@/components/FileCard";
import DropZone from "@/components/DropZone";
import VideoPlayer from "@/components/VideoPlayer";

const CATEGORIES = [
  { id: "", label: "Tümü", icon: HardDrive },
  { id: "video", label: "Video", icon: Film },
  { id: "audio", label: "Ses", icon: Music },
  { id: "image", label: "Görsel", icon: Image },
  { id: "document", label: "Belge", icon: FileText },
  { id: "archive", label: "Arşiv", icon: Archive },
];

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function HomePage() {
  const router = useRouter();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [currentFolder, setCurrentFolder] = useState("/");
  const [showUpload, setShowUpload] = useState(false);
  const [playingFile, setPlayingFile] = useState<FileItem | null>(null);
  const [stats, setStats] = useState<{ total_files: number; total_size: number } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/login"); return; }
    loadFiles();
    loadStats();
  }, []);

  async function loadFiles() {
    setLoading(true);
    try {
      const data = await listFiles({ category: category || undefined, search: search || undefined });
      setFiles(data);
    } catch {
      console.error("Dosyalar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      const s = await getStats();
      setStats(s);
    } catch { /* ignore */ }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await syncFiles(false);
      await loadFiles();
      await loadStats();
    } finally {
      setSyncing(false);
    }
  }

  const handleSearch = useCallback(
    (q: string) => {
      setSearch(q);
      // Debounce search
      const t = setTimeout(async () => {
        const data = await listFiles({ category: category || undefined, search: q || undefined });
        setFiles(data);
      }, 400);
      return () => clearTimeout(t);
    },
    [category]
  );

  async function handleCategoryChange(cat: string) {
    setCategory(cat);
    setLoading(true);
    try {
      const data = await listFiles({ category: cat || undefined, search: search || undefined });
      setFiles(data);
    } finally {
      setLoading(false);
    }
  }

  function handleFileUploaded(file: FileItem) {
    setFiles((prev) => [file, ...prev]);
    loadStats();
  }

  function handleFileDeleted(id: number) {
    setFiles((prev) => prev.filter((f) => f.message_id !== id));
    loadStats();
  }

  const filteredFiles = files.filter((f) =>
    currentFolder === "/" ? true : f.folder === currentFolder
  );

  // Unique folders
  const folders = Array.from(new Set(files.map((f) => f.folder).filter((f) => f !== "/")));

  return (
    <div className="min-h-screen flex relative z-10">
      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -280, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -280, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="w-64 flex-shrink-0 flex flex-col"
            style={{
              background: "rgba(10,10,15,0.9)",
              borderRight: "1px solid var(--border)",
              backdropFilter: "blur(20px)",
              height: "100vh",
              position: "sticky",
              top: 0,
            }}
          >
            {/* Logo */}
            <div className="p-5 flex items-center gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
                <Cloud size={18} className="text-white" />
              </div>
              <div>
                <p className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>IGLO</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Kişisel Cloud</p>
              </div>
            </div>

            {/* Storage stats */}
            {stats && (
              <div className="mx-3 mt-4 p-3 rounded-xl" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Depolama</span>
                  <HardDrive size={12} style={{ color: "var(--accent)" }} />
                </div>
                <p className="text-lg font-bold gradient-text">{formatSize(stats.total_size)}</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{stats.total_files} dosya • Telegram</p>
              </div>
            )}

            {/* Categories */}
            <nav className="flex-1 p-3 space-y-1 mt-2">
              <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Kategoriler
              </p>
              {CATEGORIES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  id={`cat-${id || "all"}`}
                  onClick={() => handleCategoryChange(id)}
                  className={`sidebar-item w-full ${category === id ? "active" : ""}`}
                  style={{ border: category === id ? "1px solid var(--border)" : "1px solid transparent" }}
                >
                  <Icon size={16} />
                  {label}
                  {category === id && files.length > 0 && (
                    <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full"
                      style={{ background: "var(--accent-glow)", color: "var(--accent)" }}>
                      {files.length}
                    </span>
                  )}
                </button>
              ))}

              {/* Folders */}
              {folders.length > 0 && (
                <>
                  <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wider mt-4" style={{ color: "var(--text-muted)" }}>
                    Klasörler
                  </p>
                  <button
                    onClick={() => setCurrentFolder("/")}
                    className={`sidebar-item w-full ${currentFolder === "/" ? "active" : ""}`}
                    style={{ border: currentFolder === "/" ? "1px solid var(--border)" : "1px solid transparent" }}
                  >
                    <FolderOpen size={16} /> Kök Klasör
                  </button>
                  {folders.map((folder) => (
                    <button
                      key={folder}
                      onClick={() => setCurrentFolder(folder)}
                      className={`sidebar-item w-full pl-5 ${currentFolder === folder ? "active" : ""}`}
                      style={{ border: currentFolder === folder ? "1px solid var(--border)" : "1px solid transparent" }}
                    >
                      <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />
                      <FolderOpen size={14} />
                      <span className="truncate text-xs">{folder.split("/").filter(Boolean).pop()}</span>
                    </button>
                  ))}
                </>
              )}
            </nav>

            {/* Bottom actions */}
            <div className="p-3 space-y-1" style={{ borderTop: "1px solid var(--border)" }}>
              <button id="nav-settings" onClick={() => router.push("/settings")} className="sidebar-item w-full">
                <Settings size={16} /> Ayarlar
              </button>
              <button id="nav-logout" onClick={logout} className="sidebar-item w-full" style={{ color: "var(--danger)" }}>
                <LogOut size={16} /> Çıkış
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center gap-3 p-4 sticky top-0 z-20"
          style={{ background: "rgba(10,10,15,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid var(--border)" }}>
          <button
            id="toggle-sidebar"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="btn-ghost p-2"
          >
            <LayoutGrid size={16} />
          </button>

          {/* Search */}
          <div className="flex-1 relative max-w-lg">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              id="search-input"
              type="text"
              className="input-field pl-9 py-2 text-sm"
              placeholder="Dosya ara..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              id="sync-btn"
              onClick={handleSync}
              disabled={syncing}
              className="btn-ghost flex items-center gap-1.5 text-xs"
            >
              <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
              Senkronize
            </button>
            <button
              id="upload-toggle-btn"
              onClick={() => setShowUpload(!showUpload)}
              className="btn-primary flex items-center gap-1.5 text-xs"
            >
              <Upload size={14} /> Yükle
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 p-6 space-y-6">
          {/* Upload zone */}
          <AnimatePresence>
            {showUpload && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <DropZone currentFolder={currentFolder} onUploadComplete={handleFileUploaded} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* File grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {category ? CATEGORIES.find((c) => c.id === category)?.label : "Tüm Dosyalar"}
                <span className="ml-2 text-sm font-normal" style={{ color: "var(--text-muted)" }}>
                  ({filteredFiles.length})
                </span>
              </h2>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-24">
                <div className="text-center">
                  <Loader2 size={32} className="animate-spin mx-auto mb-3" style={{ color: "var(--accent)" }} />
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>Dosyalar yükleniyor...</p>
                </div>
              </div>
            ) : filteredFiles.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-24"
              >
                <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                  <Cloud size={36} style={{ color: "var(--text-muted)" }} />
                </div>
                <p className="font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Henüz dosya yok</p>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Yukarıdan dosya yükle veya senkronize et
                </p>
                <button
                  onClick={() => setShowUpload(true)}
                  className="btn-primary mt-4 inline-flex items-center gap-2 text-sm"
                >
                  <Upload size={15} /> İlk Dosyayı Yükle
                </button>
              </motion.div>
            ) : (
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
              >
                {filteredFiles.map((file, index) => (
                  <FileCard
                    key={file.message_id}
                    file={file}
                    index={index}
                    onPlay={setPlayingFile}
                    onDelete={handleFileDeleted}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Video Player Modal */}
      <AnimatePresence>
        {playingFile && (
          <VideoPlayer file={playingFile} onClose={() => setPlayingFile(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
