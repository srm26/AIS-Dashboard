import React, { useEffect } from "react";
import { loginWithAzureAD } from "../auth";
import logo from "../GES-logo.webp";

const C = {
  bg: "#0c2536", surface: "#063c59", border: "#0e5278",
  blue: "#7dc3cd", green: "#c3d735", orange: "#e27124",
  textPri: "#ffffff", textSec: "#cdd0d0", textMute: "#7dc3cd",
};

export default function Login() {
  useEffect(() => {
    loginWithAzureAD();
  }, []);

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

        <div style={{ fontSize: 13, color: C.textMute }}>
          Redirecting to sign-in...
        </div>
      </div>
    </div>
  );
}
