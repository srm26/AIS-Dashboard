import React from "react";
import { loginWithAzureAD } from "../auth";
import logo from "../GES-logo.webp";

const C = {
  bg: "#0c2536", surface: "#063c59", border: "#0e5278",
  blue: "#7dc3cd", green: "#c3d735", orange: "#e27124",
  textPri: "#ffffff", textSec: "#cdd0d0", textMute: "#7dc3cd",
};

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function Login() {
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
            Global Integration Command Center
          </span>
        </div>

        <div style={{ fontSize: 20, fontWeight: 700, color: C.textPri, marginBottom: 6 }}>Sign in</div>
        <div style={{ fontSize: 13, color: C.textMute, marginBottom: 28 }}>
          Use your network account to access the dashboard.
        </div>

        <button
          onClick={loginWithAzureAD}
          style={{
            width: "100%", padding: "10px", borderRadius: 6, border: "none",
            background: C.blue, color: "#0c2536", fontWeight: 700, fontSize: 14,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          }}
        >
          <MicrosoftIcon />
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}
