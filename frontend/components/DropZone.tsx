"use client";
import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FolderOpen, X, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { uploadFile, FileItem } from "@/lib/api";

interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  result?: FileItem;
}

interface DropZoneProps {
  currentFolder: string;
  onUploadComplete: (file: FileItem) => void;
}

export default function DropZone({ currentFolder, onUploadComplete }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  function updateUpload(id: string, patch: Partial<UploadItem>) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  async function processFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const items: UploadItem[] = arr.map((f) => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      progress: 0,
      status: "pending",
    }));
    setUploads((prev) => [...prev, ...items]);

    for (const item of items) {
      updateUpload(item.id, { status: "uploading" });
      try {
        const result = await uploadFile(item.file, currentFolder, (pct) => {
          updateUpload(item.id, { progress: pct });
        });
        updateUpload(item.id, { status: "done", progress: 100, result });
        onUploadComplete(result);
        // 3 saniye sonra listeden kaldır
        setTimeout(() => setUploads((prev) => prev.filter((u) => u.id !== item.id)), 3000);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Yükleme başarısız";
        updateUpload(item.id, { status: "error", error: msg });
      }
    }
  }

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
    },
    [currentFolder]
  );

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) processFiles(e.target.files);
    e.target.value = "";
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        className={`drop-zone p-10 text-center relative ${dragging ? "drag-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <input
          id="file-input"
          type="file"
          multiple
          className="hidden"
          onChange={onInputChange}
        />
        <motion.div
          animate={{ scale: dragging ? 1.05 : 1 }}
          transition={{ duration: 0.15 }}
        >
          <div className="flex items-center justify-center mb-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: dragging ? "var(--accent-glow)" : "var(--bg-card)", border: "1px solid var(--border)" }}>
              <Upload size={24} style={{ color: dragging ? "var(--accent)" : "var(--text-muted)" }} />
            </div>
          </div>
          <p className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
            {dragging ? "Bırak!" : "Dosyaları buraya sürükle"}
          </p>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            ya da seçmek için tıkla • Her boyutta dosya desteklenir
          </p>
          <div className="flex items-center gap-1.5 justify-center mt-3">
            <FolderOpen size={12} style={{ color: "var(--accent)" }} />
            <span className="text-xs" style={{ color: "var(--accent)" }}>
              Hedef: {currentFolder === "/" ? "Kök klasör" : currentFolder}
            </span>
          </div>
        </motion.div>
      </div>

      {/* Upload progress list */}
      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            {uploads.map((u) => (
              <motion.div
                key={u.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="glass rounded-xl p-3 flex items-center gap-3"
              >
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {u.status === "uploading" && <Loader2 size={16} className="animate-spin" style={{ color: "var(--accent)" }} />}
                  {u.status === "done" && <CheckCircle size={16} style={{ color: "var(--success)" }} />}
                  {u.status === "error" && <AlertCircle size={16} style={{ color: "var(--danger)" }} />}
                  {u.status === "pending" && <div className="w-4 h-4 rounded-full" style={{ border: "2px solid var(--border)" }} />}
                </div>

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {u.file.name}
                  </p>
                  {u.status === "uploading" && (
                    <div className="progress-bar mt-1">
                      <div className="progress-bar-fill" style={{ width: `${u.progress}%` }} />
                    </div>
                  )}
                  {u.status === "done" && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--success)" }}>Yüklendi ✓</p>
                  )}
                  {u.status === "error" && (
                    <p className="text-xs mt-0.5 truncate" style={{ color: "var(--danger)" }}>{u.error}</p>
                  )}
                </div>

                {/* Size */}
                <span className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                  {(u.file.size / 1024 / 1024).toFixed(1)} MB
                </span>

                {/* Remove */}
                {(u.status === "done" || u.status === "error") && (
                  <button
                    onClick={() => setUploads((prev) => prev.filter((x) => x.id !== u.id))}
                    style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
                  >
                    <X size={14} />
                  </button>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
