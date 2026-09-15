"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play, Pause, Volume2, VolumeX, Maximize, Download, AlertCircle, Minimize } from "lucide-react";
import { getStreamUrl, getDownloadUrl, FileItem, prefetchVideo } from "@/lib/api";

const VOLUME_KEY = "iglo_volume";  // localStorage anahtarı

interface VideoPlayerProps {
  file: FileItem;
  onClose: () => void;
}

export default function VideoPlayer({ file, onClose }: VideoPlayerProps) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Ses seviyesini localStorage'dan oku (varsayılan 0.8)
  const savedVolume = typeof window !== "undefined"
    ? parseFloat(localStorage.getItem(VOLUME_KEY) ?? "0.8")
    : 0.8;

  const [playing,      setPlaying]      = useState(false);
  const [muted,        setMuted]        = useState(false);
  const [volume,       setVolume]       = useState(isNaN(savedVolume) ? 0.8 : savedVolume);
  const [progress,     setProgress]     = useState(0);
  const [buffered,     setBuffered]     = useState(0);
  const [duration,     setDuration]     = useState(0);
  const [currentTime,  setCurrentTime]  = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [hasError,     setHasError]     = useState(false);
  const [isBuffering,  setIsBuffering]  = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [srcLoaded,    setSrcLoaded]    = useState(false);

  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamUrl     = getStreamUrl(file.message_id);

  // Video oynatıcı açılır açılmaz backend'e ilk chunk'ları ön yükle
  useEffect(() => {
    prefetchVideo(file.message_id);
  }, [file.message_id]);

  function formatTime(s: number) {
    if (!s || isNaN(s) || !isFinite(s)) return "0:00";
    const m   = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  // ── Play/Pause — user gesture içinde çağrılır (Brave audio fix) ──
  const handlePlayClick = useCallback(() => {
    const v = videoRef.current;
    if (!v || hasError) return;

    if (!srcLoaded) {
      // İlk oynatma: src'yi doğrudan set et, ses seviyesini uygula
      v.src    = streamUrl;
      v.volume = volume;
      v.muted  = muted;
      v.load();
      setSrcLoaded(true);
      setIsBuffering(true);

      const tryPlay = () => {
        v.play()
          .then(() => setPlaying(true))
          .catch(() => {
            // Brave audio block → muted fallback
            v.muted = true;
            setMuted(true);
            v.play()
              .then(() => setPlaying(true))
              .catch(() => { setPlaying(false); setIsBuffering(false); });
          });
      };

      if (v.readyState >= 1) {
        tryPlay();
      } else {
        v.addEventListener("loadedmetadata", tryPlay, { once: true });
      }
      return;
    }

    // Normal toggle — buffering sırasında da çalışır
    if (v.paused) {
      v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      v.pause();
      setPlaying(false);
      setIsBuffering(false);  // pause → spinner'ı gizle
    }
  }, [streamUrl, hasError, srcLoaded, volume, muted]);

  function scheduleHideControls() {
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
  }

  function handleMouseMove() {
    setShowControls(true);
    if (playing) scheduleHideControls();
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = videoRef.current;
    if (!v || isNaN(duration) || !srcLoaded) return;
    v.currentTime = (parseFloat(e.target.value) / 100) * duration;
  }

  // ── Video event listeners ──
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => {
      if (v.duration && !isNaN(v.duration)) {
        setCurrentTime(v.currentTime);
        setProgress((v.currentTime / v.duration) * 100);
        if (v.buffered.length > 0) {
          setBuffered((v.buffered.end(v.buffered.length - 1) / v.duration) * 100);
        }
      }
    };
    const onMeta    = () => { if (v.duration && !isNaN(v.duration)) setDuration(v.duration); };
    const onEnded   = () => { setPlaying(false); setShowControls(true); };
    const onWaiting = () => { if (!v.paused) setIsBuffering(true); };   // pause edilmişse spinner çıkmasın
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);
    const onPause   = () => { setPlaying(false); setIsBuffering(false); };
    const onSeeking = () => setIsBuffering(true);
    const onSeeked  = () => setIsBuffering(false);
    const onError   = () => { setHasError(true); setPlaying(false); setIsBuffering(false); };

    // Ses değişince localStorage'a yaz
    const onVolumeChange = () => {
      if (!v.muted) {
        localStorage.setItem(VOLUME_KEY, v.volume.toString());
      }
    };

    v.addEventListener("timeupdate",     onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("ended",          onEnded);
    v.addEventListener("waiting",        onWaiting);
    v.addEventListener("playing",        onPlaying);
    v.addEventListener("canplay",        onCanPlay);
    v.addEventListener("pause",          onPause);
    v.addEventListener("seeking",        onSeeking);
    v.addEventListener("seeked",         onSeeked);
    v.addEventListener("error",          onError);
    v.addEventListener("volumechange",   onVolumeChange);

    return () => {
      v.removeEventListener("timeupdate",     onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("ended",          onEnded);
      v.removeEventListener("waiting",        onWaiting);
      v.removeEventListener("playing",        onPlaying);
      v.removeEventListener("canplay",        onCanPlay);
      v.removeEventListener("pause",          onPause);
      v.removeEventListener("seeking",        onSeeking);
      v.removeEventListener("seeked",         onSeeked);
      v.removeEventListener("error",          onError);
      v.removeEventListener("volumechange",   onVolumeChange);
    };
  }, []);

  // ── Ses/mute sync ──
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = muted ? 0 : volume;
    v.muted  = muted;
    if (!muted && volume > 0) localStorage.setItem(VOLUME_KEY, volume.toString());
  }, [volume, muted]);

  // ── Fullscreen change ──
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── Klavye kısayolları ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Input alanlarında kısayolları devre dışı bırak
      if (document.activeElement?.tagName === "INPUT") return;
      if (e.key === "Escape") { if (isFullscreen) document.exitFullscreen(); else onClose(); }
      if (e.key === " ")      { e.preventDefault(); handlePlayClick(); }
      if (e.key === "ArrowRight") {
        const v = videoRef.current;
        if (v && srcLoaded) v.currentTime = Math.min(v.currentTime + 10, duration);
      }
      if (e.key === "ArrowLeft") {
        const v = videoRef.current;
        if (v && srcLoaded) v.currentTime = Math.max(v.currentTime - 10, 0);
      }
      if (e.key === "m" || e.key === "M") setMuted(m => !m);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, handlePlayClick, isFullscreen, srcLoaded, duration]);

  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  function retryPlay() {
    const v = videoRef.current;
    if (!v) return;
    setHasError(false);
    setIsBuffering(false);
    setSrcLoaded(true);
    v.src = streamUrl + "&t=" + Date.now();
    v.load();
    v.play().catch(() => {});
  }

  // Spinner veya Play butonu — asla aynı anda gösterilmez
  const showSpinner = isBuffering && !hasError && srcLoaded;
  const showPlayBtn = !playing   && !hasError && !showSpinner;

  // Buffering sırasında kontroller her zaman görünür
  const controlsVisible = showControls || isBuffering || !playing;

  return (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { if (playing && !isBuffering) setShowControls(false); }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.97)",
          backdropFilter: "blur(12px)",
          zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
          userSelect: "none",
        }}
      >
        {/* ── Top Header ── */}
        <AnimatePresence>
          {controlsVisible && (
            <motion.div
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.18 }}
              style={{
                position: "absolute", top: 0, left: 0, right: 0,
                padding: "20px 28px",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: "linear-gradient(to bottom, rgba(0,0,0,0.88) 0%, transparent 100%)",
                zIndex: 110,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <button onClick={onClose} style={iconBtnStyle}>
                  <X size={18} />
                </button>
                <div>
                  <div style={{ color: "white", fontWeight: 600, fontSize: 14, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {file.name}
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2 }}>
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                    {isBuffering && <span style={{ marginLeft: 8, color: "rgba(99,102,241,0.9)" }}>● Yükleniyor…</span>}
                  </div>
                </div>
              </div>
              <a
                href={getDownloadUrl(file.message_id)}
                download={file.name}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  background: "rgba(255,255,255,0.12)", color: "white",
                  padding: "7px 16px", borderRadius: 99, textDecoration: "none",
                  fontSize: 13, fontWeight: 500, backdropFilter: "blur(4px)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <Download size={14} /> İndir
              </a>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Video Alanı ── */}
        <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>

          {hasError ? (
            /* ── Hata Ekranı ── */
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, color: "white" }}>
              <div style={{
                width: 72, height: 72, borderRadius: "50%",
                background: "rgba(244,63,94,0.15)", border: "1px solid rgba(244,63,94,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <AlertCircle size={32} color="#f43f5e" />
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Medya Yüklenemedi</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", maxWidth: 300, textAlign: "center", lineHeight: 1.5 }}>
                Bağlantı zaman aşımına uğradı veya dosya akışı sağlanamıyor.
              </div>
              <button onClick={retryPlay} style={retryBtnStyle}>
                Tekrar Dene
              </button>
            </div>
          ) : (
            /* ── Video ── */
            <video
              ref={videoRef}
              onClick={handlePlayClick}
              preload="none"
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "contain", cursor: "pointer" }}
            />
          )}

          {/* ── Merkez: Spinner VEYA Play — pointerEvents:none (kontrolleri engellemez) ── */}
          {!hasError && (
            <div style={{
              position: "absolute",
              top: "50%", left: "50%",
              transform: "translate(-50%,-50%)",
              pointerEvents: "none",   // ← bu div click yakalamaz, kontrollere geçer
              zIndex: 5,
            }}>
              <AnimatePresence mode="wait">
                {showSpinner ? (
                  <motion.div
                    key="spinner"
                    initial={{ opacity: 0, scale: 0.75 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.75 }}
                    transition={{ duration: 0.15 }}
                    style={overlayCircleStyle}
                  >
                    <div style={{
                      width: 30, height: 30,
                      border: "2.5px solid rgba(255,255,255,0.15)",
                      borderTopColor: "white",
                      borderRadius: "50%",
                      animation: "spin 0.8s linear infinite",
                    }} />
                  </motion.div>
                ) : showPlayBtn ? (
                  <motion.div
                    key="play"
                    initial={{ opacity: 0, scale: 0.75 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.75 }}
                    transition={{ duration: 0.15 }}
                    style={overlayCircleStyle}
                  >
                    <Play size={28} fill="white" color="white" style={{ marginLeft: 3 }} />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          )}

          {/* ── Alt Kontroller — buffering sırasında da görünür ── */}
          <AnimatePresence>
            {controlsVisible && !hasError && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{ duration: 0.18 }}
                style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  padding: "64px 28px 24px",
                  background: "linear-gradient(to top, rgba(0,0,0,0.92) 0%, transparent 100%)",
                  zIndex: 110,
                }}
              >
                {/* ── Progress Bar ── */}
                <div style={{ position: "relative", height: 20, display: "flex", alignItems: "center", marginBottom: 10, cursor: "pointer" }}>
                  {/* Track */}
                  <div style={{
                    position: "absolute", left: 0, right: 0, height: 4,
                    background: "rgba(255,255,255,0.12)", borderRadius: 99, overflow: "hidden",
                  }}>
                    {/* Buffered (gri) */}
                    <div style={{
                      position: "absolute", left: 0, width: `${buffered}%`, height: "100%",
                      background: "rgba(255,255,255,0.2)", transition: "width 0.4s",
                    }} />
                    {/* Played (mor) */}
                    <div style={{
                      position: "absolute", left: 0, width: `${progress}%`, height: "100%",
                      background: "#6366f1", transition: "width 0.1s",
                    }} />
                  </div>
                  {/* Scrubber */}
                  <input
                    type="range" min={0} max={100}
                    value={isNaN(progress) ? 0 : progress}
                    onChange={seek}
                    style={{
                      position: "absolute", left: 0, right: 0, width: "100%",
                      height: 4, margin: 0, opacity: 0, cursor: "pointer",
                      WebkitAppearance: "none", zIndex: 2,
                    }}
                  />
                </div>

                {/* ── Butonlar ── */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 18 }}>

                    {/* Play/Pause — buffering sırasında pause gösterir */}
                    <button onClick={handlePlayClick} style={ctrlBtnStyle} title={playing && !isBuffering ? "Duraklat" : "Oynat"}>
                      {playing && !isBuffering
                        ? <Pause size={22} fill="white" color="white" />
                        : isBuffering
                          ? <Pause size={22} fill="rgba(255,255,255,0.5)" color="rgba(255,255,255,0.5)" />
                          : <Play  size={22} fill="white" color="white" />}
                    </button>

                    {/* Ses */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button onClick={() => setMuted(m => !m)} style={ctrlBtnStyle}>
                        {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                      </button>
                      <input
                        type="range" min={0} max={1} step={0.02}
                        value={muted ? 0 : volume}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setVolume(val);
                          if (val > 0 && muted) setMuted(false);
                          localStorage.setItem(VOLUME_KEY, val.toString());
                        }}
                        style={volumeSliderStyle}
                      />
                    </div>

                    {/* Süre */}
                    <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: 500 }}>
                      {formatTime(currentTime)} <span style={{ opacity: 0.4 }}>/</span> {formatTime(duration)}
                    </span>
                  </div>

                  {/* Tam ekran */}
                  <button onClick={toggleFullscreen} style={ctrlBtnStyle}>
                    {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          video::-webkit-media-controls { display: none !important; }
          video::-webkit-media-controls-enclosure { display: none !important; }
        `}</style>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Style sabitleri ──
const overlayCircleStyle: React.CSSProperties = {
  width: 68, height: 68, borderRadius: "50%",
  background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)",
  display: "flex", alignItems: "center", justifyContent: "center",
  border: "1px solid rgba(255,255,255,0.08)",
};

const ctrlBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "white",
  cursor: "pointer", display: "flex", alignItems: "center",
  justifyContent: "center", padding: 4, borderRadius: 6,
  opacity: 0.9,
};

const iconBtnStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: "50%",
  background: "rgba(255,255,255,0.12)", border: "none",
  cursor: "pointer", color: "white",
  display: "flex", alignItems: "center", justifyContent: "center",
  backdropFilter: "blur(4px)", flexShrink: 0,
};

const retryBtnStyle: React.CSSProperties = {
  marginTop: 4, background: "rgba(99,102,241,0.25)",
  border: "1px solid rgba(99,102,241,0.5)",
  color: "white", padding: "9px 24px", borderRadius: 99,
  cursor: "pointer", fontSize: 13, fontWeight: 500,
};

const volumeSliderStyle: React.CSSProperties = {
  width: 80, height: 3,
  accentColor: "white",
  cursor: "pointer",
  background: "rgba(255,255,255,0.2)",
  borderRadius: 2,
  appearance: "none",
  outline: "none",
};
