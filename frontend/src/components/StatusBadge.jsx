import React from "react";

const palette = {
  Succeeded: { bg: "#1a2e0a", color: "#c3d735", border: "#c3d735" },
  Running:   { bg: "#0a2e38", color: "#7dc3cd", border: "#7dc3cd" },
  Failed:    { bg: "#3a1a0a", color: "#e27124", border: "#e27124" },
  Cancelled: { bg: "#1a2030", color: "#cdd0d0", border: "#cdd0d0" },
  Enabled:   { bg: "#1a2e0a", color: "#c3d735", border: "#c3d735" },
  Disabled:  { bg: "#1a2030", color: "#cdd0d0", border: "#cdd0d0" },
  Skipped:   { bg: "#1a2030", color: "#cdd0d0", border: "#cdd0d0" },
  TimedOut:  { bg: "#2e2200", color: "#f7bc55", border: "#f7bc55" },
  Healthy:   { bg: "#1a2e0a", color: "#c3d735", border: "#c3d735" },
};

export default function StatusBadge({ status }) {
  const c = palette[status] || { bg: "#0a2030", color: "#7dc3cd", border: "#7dc3cd" };
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 4,
      fontSize: 12, fontWeight: 600,
      background: c.bg, color: c.color,
      border: `1px solid ${c.border}33`,
    }}>
      {status || "Unknown"}
    </span>
  );
}
