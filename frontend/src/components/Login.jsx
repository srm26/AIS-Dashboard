import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { setToken } from "../auth";
import logo from "../GES-logo.webp";

const C = {
  bg: "#0c2536", surface: "#063c59", border: "#0e5278",
  blue: "#7dc3cd", green: "#c3d735", orange: "#e27124",
  textPri: "#ffffff", textSec: "#cdd0d0", textMute: "#7dc3cd",
};

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api.login(username, password);
      setToken(data.token);
      navigate("/", { replace: true });
    } catch (e) {
      setError("Invalid username or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: "40px 48px", width: 360,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
          <img src={logo} alt="GES" style={{ height: 32, objectFit: "contain" }} />
          <span style={{ fontWeight: 700, fontSize: 16, color: "#063c59",
            background: C.textMute, padding: "2px 8px", borderRadius: 4 }}>
            AIS Dashboard
          </span>
        </div>

        <div style={{ fontSize: 20, fontWeight: 700, color: C.textPri, marginBottom: 6 }}>Sign in</div>
        <div style={{ fontSize: 13, color: C.textMute, marginBottom: 28 }}>
          Enter your credentials to access the dashboard.
        </div>

        {error && (
          <div style={{
            background: "#3a1a0a", color: C.orange, borderRadius: 6,
            padding: "10px 14px", marginBottom: 20, fontSize: 13,
            border: `1px solid ${C.orange}44`,
          }}>{error}</div>
        )}

        <form onSubmit={submit}>
          <label style={{ display: "block", marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: C.textMute, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Username
            </div>
            <input
              type="text" autoComplete="username" required
              value={username} onChange={e => setUsername(e.target.value)}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "#0c2536", border: `1px solid ${C.border}`,
                borderRadius: 6, color: C.textPri,
                padding: "9px 12px", fontSize: 14, outline: "none",
              }}
            />
          </label>

          <label style={{ display: "block", marginBottom: 28 }}>
            <div style={{ fontSize: 12, color: C.textMute, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Password
            </div>
            <input
              type="password" autoComplete="current-password" required
              value={password} onChange={e => setPassword(e.target.value)}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "#0c2536", border: `1px solid ${C.border}`,
                borderRadius: 6, color: C.textPri,
                padding: "9px 12px", fontSize: 14, outline: "none",
              }}
            />
          </label>

          <button
            type="submit" disabled={loading}
            style={{
              width: "100%", padding: "10px", borderRadius: 6, border: "none",
              background: loading ? C.border : C.blue,
              color: "#0c2536", fontWeight: 700, fontSize: 14,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
