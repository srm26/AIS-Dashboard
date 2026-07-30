import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "../api/client";
import StatusBadge from "./StatusBadge";
import { format, formatDistanceToNow } from "date-fns";

const C = {
  surface: "#063c59", hover: "#0a4a6e", border: "#0e5278",
  blue: "#7dc3cd", green: "#c3d735", orange: "#e27124", gold: "#f7bc55",
  textPri: "#ffffff", textSec: "#cdd0d0", textMute: "#7dc3cd",
};

const s = {
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: C.textPri, marginBottom: 4 },
  meta: { fontSize: 13, color: C.textMute },
  btnRow: { display: "flex", gap: 8 },
  btn: {
    padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
    display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`,
    background: C.surface, color: C.textSec,
  },
  panel: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "10px 16px", fontSize: 11, color: C.textMute, borderBottom: `1px solid ${C.border}`, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },
  tr: { borderBottom: `1px solid ${C.border}` },
  td: { padding: "13px 16px", fontSize: 14, color: C.textSec },
  empty: { textAlign: "center", padding: 56, color: C.textMute },
  err: { background: "#3a1a0a", color: C.orange, borderRadius: 6, padding: "10px 16px", marginBottom: 16, fontSize: 13, border: `1px solid ${C.orange}44` },
  filterBar: { display: "flex", gap: 10, marginBottom: 16, alignItems: "center" },
  label: { fontSize: 12, color: C.textMute },
  select: {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
    color: C.textPri, padding: "7px 12px", fontSize: 13, outline: "none", cursor: "pointer",
  },
};

export default function FunctionAppDetail() {
  const { subId, rg, appName } = useParams();
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(7);
  const [pendingDays, setPendingDays] = useState(7);

  const loadExecutions = useCallback(async (d) => {
    setLoading(true); setError(null);
    try {
      const data = await api.getFunctionAppExecutions(subId, rg, appName, d);
      setExecutions(data.executions || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [subId, rg, appName]);

  useEffect(() => { loadExecutions(days); }, [loadExecutions]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilter = () => { setDays(pendingDays); loadExecutions(pendingDays); };

  return (
    <div>
      <div style={s.header}>
        <div>
          <div style={s.title}>{appName}</div>
          <div style={s.meta}>{rg} &nbsp;·&nbsp; {subId.slice(0, 8)}…</div>
        </div>
        <div style={s.btnRow}>
          <button style={s.btn} onClick={() => loadExecutions(days)}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div style={s.filterBar}>
        <span style={s.label}>Show last</span>
        <select style={s.select} value={pendingDays} onChange={e => setPendingDays(Number(e.target.value))}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
        </select>
        <button
          onClick={applyFilter}
          style={{ ...s.btn, background: C.blue, color: "#0c2536", border: "none" }}
        >
          Apply
        </button>
      </div>

      {error && <div style={s.err}>{error}</div>}

      <div style={{ ...s.panel, overflowX: "auto" }}>
        {loading ? (
          <div style={s.empty}>Loading executions...</div>
        ) : executions.length === 0 ? (
          <div style={s.empty}>No executions found in the selected time range.</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                {["Function", "Status", "Started", "Duration (ms)", "Result Code"].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {executions.map((ex, i) => (
                <ExecRow key={i} ex={ex} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ExecRow({ ex }) {
  const [hovered, setHovered] = useState(false);
  const status = ex.success ? "Succeeded" : "Failed";
  const ts = ex.timestamp ? new Date(ex.timestamp) : null;
  const durationMs = typeof ex.duration === "number" ? Math.round(ex.duration) : null;
  return (
    <tr style={{ ...s.tr, background: hovered ? C.hover : "" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <td style={{ ...s.td, color: C.blue, fontWeight: 500 }}>{ex.name || "—"}</td>
      <td style={s.td}><StatusBadge status={status} /></td>
      <td style={{ ...s.td, fontSize: 12 }}>
        {ts
          ? <span title={format(ts, "PPpp")}>{formatDistanceToNow(ts, { addSuffix: true })}</span>
          : "—"}
      </td>
      <td style={{ ...s.td, fontSize: 13 }}>{durationMs !== null ? durationMs.toLocaleString() : "—"}</td>
      <td style={{ ...s.td, fontSize: 13, color: C.textMute }}>{ex.resultCode || "—"}</td>
    </tr>
  );
}
