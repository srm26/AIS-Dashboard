import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { RefreshCw, Play, Pause } from "lucide-react";
import { api } from "../api/client";
import { isAdmin } from "../auth";
import StatusBadge from "./StatusBadge";
import { format } from "date-fns";

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
  btn: (v) => ({
    padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
    display: "flex", alignItems: "center", gap: 6, border: "none",
    background: v === "danger" ? C.orange : v === "primary" ? C.green : C.surface,
    color: v === "danger" ? "#fff" : v === "primary" ? "#0c2536" : C.textSec,
    ...(v === "default" ? { border: `1px solid ${C.border}` } : {}),
  }),
  panel: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "10px 16px", fontSize: 11, color: C.textMute, borderBottom: `1px solid ${C.border}`, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },
  tr: { borderBottom: `1px solid ${C.border}`, cursor: "pointer" },
  td: { padding: "13px 16px", fontSize: 14, color: C.textSec },
  empty: { textAlign: "center", padding: 56, color: C.textMute },
  err: { background: "#3a1a0a", color: C.orange, borderRadius: 6, padding: "10px 16px", marginBottom: 16, fontSize: 13, border: `1px solid ${C.orange}44` },
  toast: { position: "fixed", bottom: 24, right: 24, background: "#1a2e0a", color: C.green, border: `1px solid ${C.green}55`, borderRadius: 8, padding: "12px 18px", fontSize: 13, fontWeight: 600, zIndex: 999 },
};

function duration(start, end) {
  if (!start || !end) return "-";
  const ms = new Date(end) - new Date(start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export default function WorkflowDetail() {
  const { subId, rg, site, name } = useParams();
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [workflowState, setWorkflowState] = useState(null);
  const [toast, setToast] = useState(null);

  const loadRuns = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.getRuns(subId, rg, site, name);
      setRuns(data.runs || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [subId, rg, site, name]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const toggleWorkflow = async () => {
    setToggling(true);
    try {
      if (workflowState === "Disabled") {
        await api.enable(subId, rg, site, name);
        setWorkflowState("Enabled");
        showToast("Workflow enabled.");
      } else {
        await api.disable(subId, rg, site, name);
        setWorkflowState("Disabled");
        showToast("Workflow disabled.");
      }
    } catch (e) { setError(e.message); }
    finally { setToggling(false); }
  };

  return (
    <div>
      <div style={s.header}>
        <div>
          <div style={s.title}>{name}</div>
          <div style={s.meta}>{site} &nbsp;/&nbsp; {rg}</div>
        </div>
        <div style={s.btnRow}>
          <button style={s.btn("default")} onClick={loadRuns}><RefreshCw size={14} /> Refresh</button>
          {isAdmin() && (
            <button style={s.btn(workflowState === "Disabled" ? "primary" : "danger")} onClick={toggleWorkflow} disabled={toggling}>
              {workflowState === "Disabled" ? <><Play size={14} /> Enable</> : <><Pause size={14} /> Disable</>}
            </button>
          )}
        </div>
      </div>

      {error && <div style={s.err}>{error}</div>}

      <div style={s.panel}>
        {loading ? (
          <div style={s.empty}>Loading runs...</div>
        ) : runs.length === 0 ? (
          <div style={s.empty}>No runs found.</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>{["Run ID", "Status", "Started", "Duration", "Trigger", ...(isAdmin() ? [""] : [])].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr key={run.id} style={s.tr}
                  onClick={() => navigate(`/workflow/${subId}/${rg}/${site}/${name}/run/${run.name}`)}
                  onMouseEnter={e => e.currentTarget.style.background = C.hover}
                  onMouseLeave={e => e.currentTarget.style.background = ""}
                >
                  <td style={{ ...s.td, fontFamily: "monospace", fontSize: 12, color: C.blue }}>{run.name}</td>
                  <td style={s.td}><StatusBadge status={run.status} /></td>
                  <td style={{ ...s.td, fontSize: 12 }}>{run.startTime ? format(new Date(run.startTime), "MMM d, HH:mm:ss") : "-"}</td>
                  <td style={{ ...s.td, fontSize: 12 }}>{duration(run.startTime, run.endTime)}</td>
                  <td style={{ ...s.td, fontSize: 12, color: C.textMute }}>{run.trigger || "-"}</td>
                  {isAdmin() && (
                    <td style={s.td} onClick={e => e.stopPropagation()}>
                      <ResubmitButton subId={subId} rg={rg} site={site} name={name} runName={run.name} onDone={showToast} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  );
}

function ResubmitButton({ subId, rg, site, name, runName, onDone }) {
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    try { await api.resubmit(subId, rg, site, name, runName); onDone("Resubmit triggered."); }
    catch (e) { onDone(`Resubmit failed: ${e.message}`); }
    finally { setLoading(false); }
  };
  return (
    <button onClick={submit} disabled={loading} style={{
      padding: "4px 12px", borderRadius: 4, border: `1px solid ${C.blue}55`,
      cursor: "pointer", background: "transparent", color: C.blue, fontSize: 12, fontWeight: 600,
    }}>
      {loading ? "..." : "Resubmit"}
    </button>
  );
}
