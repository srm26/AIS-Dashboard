import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "../api/client";
import StatusBadge from "./StatusBadge";
import { format, formatDistanceToNow } from "date-fns";

const C = {
  surface: "#063c59", hover: "#0a4a6e", border: "#0e5278",
  blue: "#7dc3cd", green: "#c3d735", orange: "#e27124", gold: "#f7bc55",
  textPri: "#ffffff", textSec: "#cdd0d0", textMute: "#7dc3cd",
};

const TRIGGER_COLORS = {
  Timer: "#7b5ea7",
  Http: "#1a7aaa",
  Blob: "#1a8a7a",
  Queue: "#2a7a3a",
  ServiceBus: "#c87020",
  EventHub: "#b07010",
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
  filterBar: { display: "flex", gap: 10, marginBottom: 16, alignItems: "center" },
  label: { fontSize: 12, color: C.textMute },
  select: {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
    color: C.textPri, padding: "7px 12px", fontSize: 13, outline: "none", cursor: "pointer",
  },
  panel: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left", padding: "10px 16px", fontSize: 11, color: C.textMute,
    borderBottom: `1px solid ${C.border}`, textTransform: "uppercase",
    letterSpacing: "0.06em", fontWeight: 600,
  },
  tr: { borderBottom: `1px solid ${C.border}`, cursor: "pointer" },
  td: { padding: "13px 16px", fontSize: 14, color: C.textSec },
  empty: { textAlign: "center", padding: 56, color: C.textMute },
  err: {
    background: "#3a1a0a", color: C.orange, borderRadius: 6,
    padding: "10px 16px", marginBottom: 16, fontSize: 13, border: `1px solid ${C.orange}44`,
  },
};

function TriggerChip({ type }) {
  const label = type || "Unknown";
  const key = Object.keys(TRIGGER_COLORS).find(k => label.toLowerCase().includes(k.toLowerCase())) || "";
  const bg = TRIGGER_COLORS[key] || "#2a3a4a";
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
      background: bg, color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em",
    }}>{label}</span>
  );
}

export default function FunctionDetail() {
  const { subId, rg, appName, fnName } = useParams();
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(7);
  const [pendingDays, setPendingDays] = useState(7);

  const load = useCallback(async (d) => {
    setLoading(true); setError(null);
    try {
      const data = await api.getFunctionRuns(subId, rg, appName, fnName, d);
      setRuns(data.runs || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [subId, rg, appName, fnName]);

  useEffect(() => { load(days); }, [load]); // eslint-disable-line

  const apply = () => { setDays(pendingDays); load(pendingDays); };

  const openRun = (operationId) =>
    navigate(`/function-app/${subId}/${rg}/${appName}/fn/${encodeURIComponent(fnName)}/run/${encodeURIComponent(operationId)}`);

  return (
    <div>
      <div style={s.header}>
        <div>
          <div style={s.title}>{fnName}</div>
          <div style={s.meta}>{appName} &nbsp;·&nbsp; {rg}</div>
        </div>
        <div style={s.btnRow}>
          <button style={s.btn} onClick={() => load(days)}>
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
        <button onClick={apply} style={{ ...s.btn, background: C.blue, color: "#0c2536", border: "none" }}>
          Apply
        </button>
      </div>

      {error && <div style={s.err}>{error}</div>}

      <div style={{ ...s.panel, overflowX: "auto" }}>
        {loading ? (
          <div style={s.empty}>Loading runs…</div>
        ) : runs.length === 0 ? (
          <div style={s.empty}>No runs found in the selected time range.</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                {["Started", "Status", "Duration (ms)", "Trigger", "Invocation ID"].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run, i) => (
                <RunRow key={i} run={run} onClick={() => openRun(run.operation_Id)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RunRow({ run, onClick }) {
  const [hovered, setHovered] = useState(false);
  const status = run.success ? "Succeeded" : "Failed";
  const ts = run.timestamp ? new Date(run.timestamp) : null;
  const dur = typeof run.duration === "number" ? Math.round(run.duration) : null;
  return (
    <tr
      style={{ ...s.tr, background: hovered ? C.hover : "" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <td style={{ ...s.td, fontSize: 12 }}>
        {ts ? <span title={format(ts, "PPpp")}>{formatDistanceToNow(ts, { addSuffix: true })}</span> : "—"}
      </td>
      <td style={s.td}><StatusBadge status={status} /></td>
      <td style={{ ...s.td, fontSize: 13 }}>{dur !== null ? dur.toLocaleString() : "—"}</td>
      <td style={s.td}><TriggerChip type={run.triggerType} /></td>
      <td style={{ ...s.td, fontSize: 11, color: C.textMute, fontFamily: "monospace" }}>
        {run.invocationId ? run.invocationId.slice(0, 8) + "…" : "—"}
      </td>
    </tr>
  );
}
