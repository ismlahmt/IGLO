"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Shield, Key, Server, RefreshCw, Loader2, CheckCircle, Database } from "lucide-react";
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
      setSyncMsg(`✓ ${res.new_files} dosya geri yüklendi`);
    } catch {
      setSyncMsg("Senkronizasyon başarısız oldu");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="min-h-screen p-4 md:p-8 relative z-10" style={{ background: "var(--bg-0)" }}>
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-2 mb-8 text-sm hover:text-white transition-colors"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={16} /> Geri Dön
        </button>

        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-2 text-white">Sistem Ayarları</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            IGLO kişisel bulutunuzun yapılandırma ve yönetim paneli
          </p>
        </div>

        <div className="grid gap-6">
          {/* Sync */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl p-6 border transition-colors hover:border-gray-700"
            style={{ background: "var(--bg-1)", borderColor: "var(--border-default)" }}
          >
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20">
                    <Database size={20} className="text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-white">Veritabanı Senkronizasyonu</h2>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>Telegram kanalından dosyaları kurtar</p>
                  </div>
                </div>
                <p className="text-sm mt-4 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  Eğer veritabanınız silinirse veya başka bir bilgisayara geçiş yaparsanız, bu özellik sayesinde Telegram'daki tüm dosyalarınızı saniyeler içinde sisteme geri çekebilirsiniz. İşlem sırasında verileriniz asla kaybolmaz.
                </p>
                {syncMsg && (
                  <p className="text-sm mt-3 flex items-center gap-2 text-emerald-400 bg-emerald-400/10 w-fit px-3 py-1.5 rounded-lg border border-emerald-400/20">
                    <CheckCircle size={14} /> {syncMsg}
                  </p>
                )}
              </div>
              
              <button
                onClick={handleFullSync}
                disabled={syncing}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all shrink-0 bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-50"
              >
                {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {syncing ? "Taranıyor..." : "Şimdi Senkronize Et"}
              </button>
            </div>
          </motion.div>

          {/* Security */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl p-6 border transition-colors hover:border-gray-700"
            style={{ background: "var(--bg-1)", borderColor: "var(--border-default)" }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20">
                <Shield size={20} className="text-emerald-400" />
              </div>
              <div>
                <h2 className="font-semibold text-white">Güvenlik ve Şifreleme</h2>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Sistem koruma durumu</p>
              </div>
            </div>
            
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl flex items-center justify-between border" style={{ background: "var(--bg-2)", borderColor: "var(--border-subtle)" }}>
                <div>
                  <p className="text-sm font-medium text-white">AES-256 Şifreleme</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Tüm dosyalar kilitli</p>
                </div>
                <div className="px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wide uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Aktif
                </div>
              </div>
              <div className="p-4 rounded-xl flex items-center justify-between border" style={{ background: "var(--bg-2)", borderColor: "var(--border-subtle)" }}>
                <div>
                  <p className="text-sm font-medium text-white">JWT Kimlik Doğrulama</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>24 saatlik oturum</p>
                </div>
                <div className="px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wide uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Aktif
                </div>
              </div>
            </div>
          </motion.div>

          {/* Telegram */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-2xl p-6 border transition-colors hover:border-gray-700"
            style={{ background: "var(--bg-1)", borderColor: "var(--border-default)" }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-500/10 border border-blue-500/20">
                <Server size={20} className="text-blue-400" />
              </div>
              <div>
                <h2 className="font-semibold text-white">Telegram Bağlantısı</h2>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Depolama kanalı yapılandırması</p>
              </div>
            </div>
            
            <div className="p-4 rounded-xl border" style={{ background: "var(--bg-2)", borderColor: "var(--border-subtle)" }}>
              <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
                Bağlı Kanal ID
              </label>
              <input
                type="text"
                className="w-full bg-black/50 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-gray-400 outline-none"
                placeholder="-100xxxxxxxxxx"
                value="[GİZLİ]"
                disabled
              />
              <p className="text-xs mt-3 flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                Kanalı değiştirmek için ana dizindeki <code className="bg-gray-800/50 px-1.5 py-0.5 rounded text-gray-300">.env</code> dosyasını düzenleyin.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
