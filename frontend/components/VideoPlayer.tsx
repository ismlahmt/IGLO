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
  const [hasInteracted, setHasInteracted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamUrl = getStreamUrl(file.message_id);

  function formatTime(s: number) {
    if (isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    
    if (!hasInteracted) {
      setHasInteracted(true);
      setPlaying(true);
      return; // src atanması için render'ı bekle
    }

    if (v.paused) { 
      const playPromise = v.play();
      if (playPromise !== undefined) {
        playPromise.then(() => setPlaying(true)).catch(() => setPlaying(false));
      } else {
        setPlaying(true);
      }
    }
    else { v.pause(); setPlaying(false); }
  }

  useEffect(() => {
    // If hasInteracted just became true, we need to play the video once the src is updated
    if (hasInteracted && playing && videoRef.current && videoRef.current.paused) {
      if (videoRef.current.src) {
         videoRef.current.play().catch(() => setPlaying(false));
      }
    }
  }, [hasInteracted, playing]);

  function handleMouseMove() {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    if (playing) {
      controlsTimer.current = setTimeout(() => setShowControls(false), 2500);
    }
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = videoRef.current;
    if (!v || isNaN(duration)) return;
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
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);

    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("ended", onEnded);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("canplay", onCanPlay);
    
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("canplay", onCanPlay);
    };
  }, [playing]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = muted;
    }
  }, [volume, muted]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [playing, onClose]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onMouseMove={handleMouseMove}
        onClick={(e) => e.target === e.currentTarget && onClose()}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.95)",
          backdropFilter: "blur(10px)",
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Top Header (Floating) */}
        <AnimatePresence>
          {showControls && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              style={{
                position: "absolute",
                top: 0, left: 0, right: 0,
                padding: "20px 32px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)",
                zIndex: 110,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", padding: 8, borderRadius: "50%", cursor: "pointer", color: "white" }}>
                  <X size={20} />
                </button>
                <div>
                  <div style={{ color: "white", fontWeight: 600, fontSize: 15 }}>{file.name}</div>
                  <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                </div>
              </div>
              <a
                href={getDownloadUrl(file.message_id)}
                download={file.name}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: "rgba(255,255,255,0.1)", color: "white",
                  padding: "8px 16px", borderRadius: 99, textDecoration: "none",
                  fontSize: 13, fontWeight: 600
                }}
              >
                <Download size={16} /> İndir
              </a>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Video Container */}
        <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          
          {hasError ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "white" }}>
              <AlertCircle size={48} style={{ color: "var(--rose)" }} />
              <div style={{ fontSize: 16, fontWeight: 600 }}>Medya Yüklenemedi</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", maxWidth: 300, textAlign: "center" }}>
                Bağlantı zaman aşımına uğradı veya dosya akışı sağlanamıyor.
              </div>
            </div>
          ) : (
            <video
              ref={videoRef}
              src={hasInteracted ? streamUrl : undefined}
              onClick={togglePlay}
              onError={() => { setHasError(true); setPlaying(false); setIsBuffering(false); }}
              playsInline
              preload="none"
              style={{ width: "100%", height: "100%", objectFit: "contain", cursor: "pointer" }}
            />
          )}

          {/* Buffering Indicator */}
          {isBuffering && !hasError && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none" }}>
               <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
                 <div style={{ width: 30, height: 30, border: "3px solid rgba(255,255,255,0.2)", borderTopColor: "white", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
               </div>
            </div>
          )}

          <AnimatePresence>
            {!playing && !hasError && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none" }}
              >
                <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
                  <Play size={32} fill="white" color="white" className="ml-1" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom Controls */}
          <AnimatePresence>
            {showControls && !hasError && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                style={{
                  position: "absolute",
                  bottom: 0, left: 0, right: 0,
                  padding: "40px 32px 24px 32px",
                  background: "linear-gradient(to top, rgba(0,0,0,0.9), transparent)",
                  zIndex: 110,
                }}
              >
                {/* Timeline */}
                <div style={{ position: "relative", height: 24, display: "flex", alignItems: "center", cursor: "pointer" }}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Number.isNaN(progress) ? 0 : progress}
                    onChange={seek}
                    style={{
                      width: "100%",
                      margin: 0,
                      accentColor: "#6366f1",
                      cursor: "pointer",
                      height: 4,
                      background: "rgba(255,255,255,0.2)",
                      borderRadius: 2,
                      appearance: "none",
                      outline: "none",
                    }}
                  />
                </div>

                {/* Buttons */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                    <button onClick={togglePlay} style={{ background: "none", border: "none", color: "white", cursor: "pointer" }}>
                      {playing ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" />}
                    </button>
                    
                    <div className="volume-control" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => setMuted(!muted)} style={{ background: "none", border: "none", color: "white", cursor: "pointer" }}>
                        {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={muted ? 0 : volume}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setVolume(val);
                          if (val > 0 && muted) setMuted(false);
                        }}
                        style={{
                          width: 80,
                          margin: 0,
                          accentColor: "white",
                          cursor: "pointer",
                          height: 4,
                          background: "rgba(255,255,255,0.2)",
                          borderRadius: 2,
                          appearance: "none",
                          outline: "none",
                        }}
                      />
                    </div>
                    
                    <span style={{ color: "white", fontSize: 13, fontWeight: 500, opacity: 0.8 }}>
                      {videoRef.current ? formatTime(videoRef.current.currentTime) : "0:00"} / {formatTime(duration)}
                    </span>
                  </div>
                  
                  <button onClick={() => videoRef.current?.requestFullscreen()} style={{ background: "none", border: "none", color: "white", cursor: "pointer" }}>
                    <Maximize size={20} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <style>{`
          input[type=range]::-webkit-slider-thumb {
            appearance: none;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #6366f1;
            cursor: pointer;
            border: 2px solid white;
          }
          video::-webkit-media-controls {
            display: none !important;
          }
          video::-webkit-media-controls-enclosure {
            display: none !important;
          }
        `}</style>
      </motion.div>
    </AnimatePresence>
  );
}
