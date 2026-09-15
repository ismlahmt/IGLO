"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Shield, Key, Server, RefreshCw, Loader2, CheckCircle, Database } from "lucide-react";
import { syncFiles } from "@/lib/api";
import { motion } from "framer-motion";

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
    <div style={{ background: "var(--bg-0)", minHeight: "100vh", padding: "40px 20px" }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        
        <button 
          className="btn btn-secondary" 
          onClick={() => router.push("/")}
          style={{ marginBottom: 30, display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <ArrowLeft size={16} /> Geri Dön
        </button>

        <div style={{ marginBottom: 40 }}>
          <h1 className="gradient-text" style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 8 }}>Sistem Ayarları</h1>
          <p style={{ color: "var(--text-3)", fontSize: 14 }}>
            IGLO kişisel bulutunuzun yapılandırma ve yönetim paneli
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          
          {/* Sync Card */}
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 20 }}>
              <div style={{ flex: "1 1 300px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Database size={20} style={{ color: "#818cf8" }} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>Veritabanı Senkronizasyonu</h2>
                    <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0, marginTop: 2 }}>Telegram kanalından dosyaları kurtar</p>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 16 }}>
                  Eğer veritabanınız silinirse veya başka bir cihaza geçerseniz, bu özellik sayesinde Telegram'daki tüm dosyalarınızı saniyeler içinde sisteme geri çekebilirsiniz. İşlem sırasında verileriniz asla kaybolmaz.
                </p>
                {syncMsg && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 8, color: "var(--emerald)", fontSize: 13 }}>
                    <CheckCircle size={16} /> {syncMsg}
                  </div>
                )}
              </div>
              <button 
                className="btn btn-primary" 
                onClick={handleFullSync} 
                disabled={syncing}
                style={{ padding: "12px 20px" }}
              >
                {syncing ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                {syncing ? "Taranıyor..." : "Şimdi Senkronize Et"}
              </button>
            </div>
          </motion.div>

          {/* Security Card */}
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Shield size={20} style={{ color: "#34d399" }} />
              </div>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>Güvenlik ve Şifreleme</h2>
                <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0, marginTop: 2 }}>Sistem koruma durumu</p>
              </div>
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
              <div style={{ padding: 16, borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-1)", marginBottom: 4 }}>AES-256 Şifreleme</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>Tüm dosyalar kilitli</div>
                </div>
                <div className="badge badge-success" style={{ fontWeight: 700, fontSize: 11, padding: "4px 8px" }}>AKTİF</div>
              </div>
              <div style={{ padding: 16, borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-1)", marginBottom: 4 }}>JWT Kimlik Doğrulama</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>24 saatlik oturum</div>
                </div>
                <div className="badge badge-success" style={{ fontWeight: 700, fontSize: 11, padding: "4px 8px" }}>AKTİF</div>
              </div>
            </div>
          </motion.div>

          {/* Telegram Channel Card */}
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Server size={20} style={{ color: "#60a5fa" }} />
              </div>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>Telegram Bağlantısı</h2>
                <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0, marginTop: 2 }}>Depolama kanalı yapılandırması</p>
              </div>
            </div>
            
            <div style={{ padding: 16, borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--border-subtle)" }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "var(--text-2)", marginBottom: 8 }}>Bağlı Kanal ID</label>
              <input 
                className="input" 
                type="text" 
                value="[GİZLİ]" 
                disabled 
                style={{ padding: "10px 14px", borderRadius: 8, color: "var(--text-3)", opacity: 0.7 }}
              />
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 12, marginBottom: 0 }}>
                Kanalı değiştirmek için ana dizindeki <code style={{ background: "var(--bg-1)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border-subtle)" }}>.env</code> dosyasını düzenleyin.
              </p>
            </div>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
