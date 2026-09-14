"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Shield, Key, Server, RefreshCw, Loader2, CheckCircle } from "lucide-react";
import { syncFiles } from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  async function handleFullSync() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const res = await syncFiles(true);
      setSyncMsg(`✓ ${res.new_files} dosya bulundu`);
    } catch {
      setSyncMsg("Senkronizasyon başarısız");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="min-h-screen p-6 relative z-10 max-w-2xl mx-auto">
      <button
        id="back-btn"
        onClick={() => router.push("/")}
        className="btn-ghost flex items-center gap-2 mb-6 text-sm"
      >
        <ArrowLeft size={15} /> Geri
      </button>

      <h1 className="text-2xl font-bold mb-2 gradient-text">Ayarlar</h1>
      <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
        IGLO yapılandırma ve yönetim paneli
      </p>

      <div className="space-y-4">
        {/* Telegram */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-6"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "#6366f118", border: "1px solid #6366f130" }}>
              <Server size={18} style={{ color: "var(--accent)" }} />
            </div>
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>Telegram Bağlantısı</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Depolama kanalı yapılandırması</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                Kanal ID
              </label>
              <input
                id="settings-channel-id"
                type="text"
                className="input-field text-sm"
                placeholder="-100xxxxxxxxxx"
                disabled
              />
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                Değiştirmek için .env dosyasını düzenleyin ve sunucuyu yeniden başlatın
              </p>
            </div>
          </div>
        </motion.div>

        {/* Sync */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass rounded-2xl p-6"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "#22d3a018", border: "1px solid #22d3a030" }}>
              <RefreshCw size={18} style={{ color: "var(--success)" }} />
            </div>
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>Cache & Senkronizasyon</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Telegram kanalından dosyaları yeniden tara</p>
            </div>
          </div>
          <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
            Tam senkronizasyon, kanalın tüm geçmişini tarar ve cache&apos;i sıfırdan oluşturur.
            Uzun sürebilir.
          </p>
          {syncMsg && (
            <p className="text-sm mb-3 flex items-center gap-2" style={{ color: "var(--success)" }}>
              <CheckCircle size={14} /> {syncMsg}
            </p>
          )}
          <button
            id="full-sync-btn"
            onClick={handleFullSync}
            disabled={syncing}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {syncing ? "Taranıyor..." : "Tam Senkronizasyon"}
          </button>
        </motion.div>

        {/* Security */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass rounded-2xl p-6"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "#8b5cf618", border: "1px solid #8b5cf630" }}>
              <Shield size={18} style={{ color: "var(--accent-2)" }} />
            </div>
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>Güvenlik</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Şifreleme ve kimlik doğrulama</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>AES-256 Şifreleme</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Tüm dosyalar şifreli</p>
              </div>
              <div className="px-2 py-1 rounded-full text-xs font-medium"
                style={{ background: "#22d3a020", color: "var(--success)", border: "1px solid #22d3a030" }}>
                Aktif
              </div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>JWT Kimlik Doğrulama</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>24 saatlik oturum süresi</p>
              </div>
              <div className="px-2 py-1 rounded-full text-xs font-medium"
                style={{ background: "#22d3a020", color: "var(--success)", border: "1px solid #22d3a030" }}>
                Aktif
              </div>
            </div>
          </div>
        </motion.div>

        {/* Migration */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass rounded-2xl p-6"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "#f59e0b18", border: "1px solid #f59e0b30" }}>
              <Key size={18} style={{ color: "var(--warning)" }} />
            </div>
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>Kanal Göçü</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Dosyaları farklı bir kanala taşı</p>
            </div>
          </div>
          <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
            Mevcut kanalındaki tüm dosyaları yeni bir Telegram kanalına taşır.
            Şifreli dosyalar olduğu gibi aktarılır.
          </p>
          <button
            id="migrate-btn"
            onClick={() => router.push("/migrate")}
            className="btn-ghost text-sm flex items-center gap-2"
            style={{ color: "var(--warning)", borderColor: "#f59e0b40" }}
          >
            <Key size={14} /> Kanal Göç Sihirbazı
          </button>
        </motion.div>
      </div>
    </div>
  );
}
