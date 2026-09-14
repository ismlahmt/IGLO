"use client";
import { motion } from "framer-motion";
import {
  Film, Music, Image, FileText, Archive, File,
  Play, Download, Trash2, MoreVertical
} from "lucide-react";
import { useState } from "react";
import { FileItem, deleteFile, getDownloadUrl } from "@/lib/api";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  video: Film,
  audio: Music,
  image: Image,
  document: FileText,
  archive: Archive,
  other: File,
};

const CATEGORY_COLORS: Record<string, string> = {
  video: "#6366f1",
  audio: "#8b5cf6",
  image: "#22d3a0",
  document: "#f59e0b",
  archive: "#f43f5e",
  other: "#9898b0",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function getCategory(file: FileItem): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mkv", "avi", "mov", "webm", "m4v"].includes(ext)) return "video";
  if (["mp3", "flac", "wav", "ogg", "aac", "m4a"].includes(ext)) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["pdf", "doc", "docx", "txt", "xls", "xlsx"].includes(ext)) return "document";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  return "other";
}

interface FileCardProps {
  file: FileItem;
  onPlay: (file: FileItem) => void;
  onDelete: (id: number) => void;
  index: number;
}

export default function FileCard({ file, onPlay, onDelete, index }: FileCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const category = getCategory(file);
  const Icon = CATEGORY_ICONS[category] ?? File;
  const color = CATEGORY_COLORS[category] ?? "#9898b0";
  const isPlayable = ["video", "audio"].includes(category);
  const date = new Date(file.date);

  async function handleDelete() {
    if (!confirm(`"${file.name}" silinsin mi?`)) return;
    setDeleting(true);
    try {
      await deleteFile(file.message_id);
      onDelete(file.message_id);
    } catch {
      alert("Silme başarısız");
      setDeleting(false);
    }
  }

  return (
    <motion.div
      className="file-card group"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.25 }}
      layout
    >
      {/* Thumbnail / Icon */}
      <div
        className="flex items-center justify-center relative"
        style={{
          height: 140,
          background: `radial-gradient(circle at 30% 30%, ${color}18, ${color}05)`,
        }}
        onClick={() => isPlayable && onPlay(file)}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: `${color}18`, border: `1px solid ${color}30` }}
        >
          <Icon size={28} style={{ color }} />
        </div>

        {/* Play button overlay */}
        {isPlayable && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ background: "rgba(0,0,0,0.5)" }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: "rgba(99,102,241,0.9)" }}>
              <Play size={20} fill="white" color="white" className="ml-0.5" />
            </div>
          </div>
        )}

        {/* Category badge */}
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-medium"
          style={{ background: `${color}20`, color, border: `1px solid ${color}30` }}>
          {category}
        </div>

        {/* More menu */}
        <div className="absolute top-2 right-2">
          <button
            id={`file-menu-${file.message_id}`}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: "rgba(0,0,0,0.6)", color: "white", border: "none", cursor: "pointer" }}
          >
            <MoreVertical size={14} />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-8 z-10 rounded-xl py-1 min-w-[140px]"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {isPlayable && (
                <button
                  onClick={() => { setMenuOpen(false); onPlay(file); }}
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/5 transition-colors"
                  style={{ color: "var(--text-primary)", background: "none", border: "none", cursor: "pointer" }}
                >
                  <Play size={13} style={{ color: "var(--accent)" }} /> Oynat
                </button>
              )}
              <a
                href={getDownloadUrl(file.message_id)}
                download={file.name}
                onClick={() => setMenuOpen(false)}
                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/5 transition-colors"
                style={{ color: "var(--text-primary)", textDecoration: "none", display: "flex" }}
              >
                <Download size={13} style={{ color: "var(--success)" }} /> İndir
              </a>
              <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
              <button
                onClick={() => { setMenuOpen(false); handleDelete(); }}
                disabled={deleting}
                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/5 transition-colors"
                style={{ color: "var(--danger)", background: "none", border: "none", cursor: "pointer" }}
              >
                <Trash2 size={13} /> {deleting ? "Siliniyor..." : "Sil"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <p
          className="text-sm font-medium truncate mb-1"
          style={{ color: "var(--text-primary)" }}
          title={file.name}
        >
          {file.name}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {formatSize(file.size)}
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {date.toLocaleDateString("tr-TR")}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
