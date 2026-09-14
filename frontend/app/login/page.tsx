"use client";
import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { motion } from "framer-motion";
import { Eye, EyeOff, Loader2, ArrowRight, Lock, User } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      router.push("/");
    } catch {
      setError("Kullanıcı adı veya şifre hatalı");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        position: "relative",
        zIndex: 1,
      }}
    >
      {/* Center glow */}
      <div style={{
        position: "fixed",
        width: 600,
        height: 600,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(99,102,241,0.1), transparent 70%)",
        filter: "blur(60px)",
        pointerEvents: "none",
        top: "50%",
        left: "50%",
        transform: "translate(-50%,-50%)",
      }} />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        style={{ width: "100%", maxWidth: 400 }}
      >
        {/* Logo mark */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.1) inset, 0 8px 32px rgba(99,102,241,0.35)",
            }}
          >
            <span style={{ fontSize: 22, fontWeight: 900, color: "white", letterSpacing: -1 }}>IG</span>
          </motion.div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "var(--text-1)", letterSpacing: -0.8, marginBottom: 6 }}>
            IGLO
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>
            Kişisel Cloud Depolama
          </p>
        </div>

        {/* Card */}
        <div className="glass-card" style={{ padding: 28 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>Giriş Yap</h2>
          <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 24 }}>Hesabına erişmek için bilgilerini gir</p>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Username */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Kullanıcı Adı
              </label>
              <div style={{ position: "relative" }}>
                <User size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-4)" }} />
                <input
                  id="username"
                  type="text"
                  className="input input-icon"
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Şifre
              </label>
              <div style={{ position: "relative" }}>
                <Lock size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-4)" }} />
                <input
                  id="password"
                  type={showPass ? "text" : "password"}
                  className="input input-icon"
                  style={{ paddingRight: 40 }}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-3)",
                    display: "flex",
                    padding: 4,
                  }}
                >
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  fontSize: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "var(--rose-dim)",
                  border: "1px solid rgba(244,63,94,0.2)",
                  color: "var(--rose)",
                  fontWeight: 500,
                }}
              >
                {error}
              </motion.div>
            )}

            {/* Submit */}
            <button
              id="login-btn"
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: "100%", justifyContent: "center", padding: "11px 20px", marginTop: 4, fontSize: 14, opacity: loading ? 0.8 : 1 }}
            >
              {loading ? <Loader2 size={15} className="spin" /> : <ArrowRight size={15} />}
              {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
            </button>
          </form>
        </div>

        <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-4)", marginTop: 20 }}>
          IGLO · Telegram destekli şifreli depolama
        </p>
      </motion.div>
    </div>
  );
}
