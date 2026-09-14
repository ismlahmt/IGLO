"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { startMigration, getMigrationStatus } from "@/lib/api";

export default function MigratePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [newChannelId, setNewChannelId] = useState("");
  const [newSession, setNewSession] = useState("");
  const [status, setStatus] = useState<{
    status: string; total: number; transferred: number; current_file: string; error?: string;
  } | null>(null);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (polling) {
      interval = setInterval(async () => {
        const s = await getMigrationStatus();
        setStatus(s);
        if (s.status === "done" || s.status === "error") {
          setPolling(false);
          setStep(3);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [polling]);

  async function startMig() {
    if (!newChannelId) return;
    try {
      await startMigration(parseInt(newChannelId), newSession || undefined);
      setStep(2);
      setPolling(true);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Göç başlatılamadı");
    }
  }

  const progress = status ? (status.total > 0 ? (status.transferred / status.total) * 100 : 0) : 0;

  return (
    <div className="min-h-screen p-6 relative z-10 max-w-xl mx-auto">
      <button onClick={() => router.push("/settings")} className="btn-ghost flex items-center gap-2 mb-6 text-sm">
        <ArrowLeft size={15} /> Ayarlar
      </button>

      <h1 className="text-2xl font-bold mb-2 gradient-text">Kanal Göç Sihirbazı</h1>
      <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
        Dosyalarını yeni bir Telegram kanalına taşı
      </p>

      {/* Steps */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
              style={{
                background: step >= s ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "var(--bg-card)",
                border: step >= s ? "none" : "1px solid var(--border)",
                color: step >= s ? "white" : "var(--text-muted)",
              }}>
              {s}
            </div>
            {s < 3 && <div className="flex-1 h-px" style={{ background: step > s ? "var(--accent)" : "var(--border)", width: 40 }} />}
          </div>
        ))}
      </div>

      {/* Step 1: Configure */}
      {step === 1 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 space-y-4">
          <h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>Hedef Kanal Bilgileri</h2>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Yeni Kanal ID *
            </label>
            <input
              id="new-channel-id"
              type="text"
              className="input-field text-sm"
              placeholder="-100xxxxxxxxxx"
              value={newChannelId}
              onChange={(e) => setNewChannelId(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Yeni Hesap Session String (farklı hesap için, opsiyonel)
            </label>
            <textarea
              id="new-session"
              className="input-field text-sm resize-none"
              rows={3}
              placeholder="BQA... (boş bırakırsan mevcut hesap kullanılır)"
              value={newSession}
              onChange={(e) => setNewSession(e.target.value)}
            />
          </div>
          <div className="p-3 rounded-xl text-sm" style={{ background: "#f59e0b10", border: "1px solid #f59e0b20", color: "#fcd34d" }}>
            ⚠️ Göç sırasında dosyalara erişim geçici olarak yavaşlayabilir.
          </div>
          <button
            id="start-migrate-btn"
            onClick={startMig}
            disabled={!newChannelId}
            className="btn-primary w-full flex items-center justify-center gap-2"
            style={{ opacity: !newChannelId ? 0.5 : 1 }}
          >
            Göçü Başlat <ArrowRight size={16} />
          </button>
        </motion.div>
      )}

      {/* Step 2: Progress */}
      {step === 2 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 space-y-6">
          <h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>Göç Devam Ediyor</h2>
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse-glow"
              style={{ background: "var(--accent-glow)", border: "2px solid var(--accent)" }}>
              <Loader2 size={28} className="animate-spin" style={{ color: "var(--accent)" }} />
            </div>
            <p className="text-3xl font-bold gradient-text mb-1">{Math.round(progress)}%</p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {status?.transferred ?? 0} / {status?.total ?? 0} dosya aktarıldı
            </p>
          </div>
          <div className="progress-bar" style={{ height: 6 }}>
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
          {status?.current_file && (
            <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
              Aktarılıyor: {status.current_file}
            </p>
          )}
        </motion.div>
      )}

      {/* Step 3: Done */}
      {step === 3 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 text-center space-y-4">
          {status?.status === "done" ? (
            <>
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                style={{ background: "#22d3a018", border: "2px solid #22d3a060" }}>
                <CheckCircle size={32} style={{ color: "var(--success)" }} />
              </div>
              <h2 className="font-bold text-xl" style={{ color: "var(--text-primary)" }}>Göç Tamamlandı!</h2>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {status.total} dosya başarıyla yeni kanala aktarıldı.
              </p>
              <p className="text-xs p-3 rounded-xl" style={{ background: "var(--bg-primary)", color: "var(--text-secondary)" }}>
                Şimdi .env dosyasındaki TELEGRAM_CHANNEL_ID değerini yeni kanal ID&apos;si ile güncelleyin ve sunucuyu yeniden başlatın.
              </p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                style={{ background: "#f43f5e18", border: "2px solid #f43f5e60" }}>
                <AlertCircle size={32} style={{ color: "var(--danger)" }} />
              </div>
              <h2 className="font-bold text-xl" style={{ color: "var(--text-primary)" }}>Hata Oluştu</h2>
              <p className="text-sm" style={{ color: "var(--danger)" }}>{status?.error}</p>
            </>
          )}
          <button id="back-to-settings" onClick={() => router.push("/settings")} className="btn-primary flex items-center gap-2 mx-auto">
            <ArrowLeft size={15} /> Ayarlara Dön
          </button>
        </motion.div>
      )}
    </div>
  );
}
