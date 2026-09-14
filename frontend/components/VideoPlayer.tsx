"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play, Pause, Volume2, VolumeX, Maximize, Download, AlertCircle } from "lucide-react";
import { getStreamUrl, getDownloadUrl, FileItem } from "@/lib/api";

interface VideoPlayerProps {
  file: FileItem;
  onClose: () => void;
}

export default function VideoPlayer({ file, onClose }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [hasError, setHasError] = useState(false);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamUrl = getStreamUrl(file.message_id);

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { 
      const playPromise = v.play();
      if (playPromise !== undefined) {
        playPromise.then(() => setPlaying(true)).catch((error) => console.error("Play interrupted:", error));
      } else {
        setPlaying(true);
      }
    }
    else { v.pause(); setPlaying(false); }
  }

  function handleMouseMove() {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    if (playing) {
      controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
    }
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = (parseFloat(e.target.value) / 100) * duration;
  }

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      if (v.duration && !isNaN(v.duration)) {
        setProgress((v.currentTime / v.duration) * 100);
      } else {
        setProgress(0);
      }
    };
    const onMeta = () => {
      if (v.duration && !isNaN(v.duration)) {
        setDuration(v.duration);
      }
    };
    const onEnded = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("ended", onEnded);
    };
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, onClose]);

  return (
    <AnimatePresence>
      <motion.div
        className="modal-bg"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          className="relative w-full max-w-5xl mx-4 flex flex-col justify-center"
          style={{ maxHeight: "95vh" }}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseMove={handleMouseMove}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3 px-1">
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{file.name}</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {formatTime(duration)} • {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={getDownloadUrl(file.message_id)}
                className="btn-ghost flex items-center gap-1.5 text-xs"
                download={file.name}
              >
                <Download size={13} /> İndir
              </a>
              <button
                id="close-video-player"
                onClick={onClose}
                className="btn-ghost p-2"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Video */}
          <div
            className="video-player-container relative rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center"
            style={{ 
              background: "#04040a", 
              border: "1px solid rgba(255,255,255,0.1)", 
              aspectRatio: "16/9", 
              maxHeight: "calc(90vh - 60px)" 
            }}
          >
            {hasError ? (
              <div className="flex flex-col items-center justify-center text-center p-6">
                <AlertCircle size={48} className="mb-4" style={{ color: "var(--rose)" }} />
                <p className="text-sm font-semibold mb-2" style={{ color: "var(--text-1)" }}>Video Yüklenemedi</p>
                <p className="text-xs max-w-xs" style={{ color: "var(--text-3)" }}>
                  Medya sunucudan çekilirken bir sorun oluştu. Bağlantı zaman aşımına uğramış olabilir. Lütfen daha sonra tekrar deneyin veya videoyu indirin.
                </p>
              </div>
            ) : (
              <video
                ref={videoRef}
                src={streamUrl}
                muted={muted}
                onClick={togglePlay}
                onError={() => { setHasError(true); setPlaying(false); }}
                style={{ width: "100%", height: "100%", objectFit: "contain", cursor: "pointer" }}
              />
            )}

            {/* Play/Pause overlay */}
            <AnimatePresence>
              {!playing && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  <div className="w-16 h-16 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(99,102,241,0.85)", boxShadow: "0 0 40px #6366f180" }}>
                    <Play size={24} fill="white" color="white" className="ml-1" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Controls */}
            <AnimatePresence>
              {showControls && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute bottom-0 left-0 right-0 p-4"
                  style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9), transparent)" }}
                >
                  {/* Progress */}
                  <input
                    id="video-seek"
                    type="range"
                    min={0}
                    max={100}
                    value={Number.isNaN(progress) ? 0 : progress}
                    onChange={seek}
                    className="w-full mb-3"
                    style={{ accentColor: "#6366f1", cursor: "pointer" }}
                  />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button id="video-play-pause" onClick={togglePlay} className="text-white hover:text-indigo-400 transition-colors">
                        {playing ? <Pause size={20} fill="white" /> : <Play size={20} fill="white" />}
                      </button>
                      <button id="video-mute" onClick={() => setMuted(!muted)} className="text-white hover:text-indigo-400 transition-colors">
                        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                      </button>
                      <span className="text-xs text-white/70">
                        {videoRef.current ? formatTime(videoRef.current.currentTime) : "0:00"} / {formatTime(duration)}
                      </span>
                    </div>
                    <button
                      id="video-fullscreen"
                      onClick={() => videoRef.current?.requestFullscreen()}
                      className="text-white hover:text-indigo-400 transition-colors"
                    >
                      <Maximize size={17} />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
