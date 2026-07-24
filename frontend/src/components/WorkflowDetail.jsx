import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { RefreshCw, Play, Pause, Pencil, X, Check } from "lucide-react";
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
    background: v === "danger" ? C.orange : v === "primary" ? C.green : v === "run" ? C.blue : C.surface,
    color: v === "danger" ? "#fff" : v === "primary" ? "#0c2536" : v === "run" ? "#0c2536" : C.textSec,
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
  const [running, setRunning] = useState(false);
  const [workflowState, setWorkflowState] = useState(null);
  const [toast, setToast] = useState(null);
  const [metadata, setMetadata] = useState({});
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaForm, setMetaForm] = useState({});
  const [savingMeta, setSavingMeta] = useState(false);

  const todayStr = () => new Date().toISOString().slice(0, 10);
  const daysAgoStr = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const [startDate, setStartDate] = useState(() => daysAgoStr(7));
  const [endDate, setEndDate] = useState(() => todayStr());
  const [pendingStart, setPendingStart] = useState(() => daysAgoStr(7));
  const [pendingEnd, setPendingEnd] = useState(() => todayStr());

  const workflowId = `/subscriptions/${subId}/resourceGroups/${rg}/providers/Microsoft.Web/sites/${site}/workflows/${name}`;

  const loadRuns = useCallback(async (sd, ed) => {
    setLoading(true); setError(null);
    try {
      const data = await api.getRuns(subId, rg, site, name, sd, ed);
      setRuns(data.runs || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [subId, rg, site, name]);

  useEffect(() => { loadRuns(startDate, endDate); }, [loadRuns]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilter = () => {
    setStartDate(pendingStart);
    setEndDate(pendingEnd);
    loadRuns(pendingStart, pendingEnd);
  };

  useEffect(() => {
    api.getMetadata().then(data => {
      const m = (data.metadata || {})[workflowId] || {};
      setMetadata(m);
      setMetaForm(m);
    }).catch(() => {});
  }, [workflowId]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const saveMeta = async () => {
    setSavingMeta(true);
    try {
      await api.updateWorkflowMetadata({ workflow_id: workflowId, ...metaForm });
      setMetadata({ ...metaForm });
      setEditingMeta(false);
      showToast("Metadata saved.");
    } catch (e) { showToast(`Save failed: ${e.message}`); }
    finally { setSavingMeta(false); }
  };

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

  const runWorkflow = async () => {
    setRunning(true);
    try {
      await api.run(subId, rg, site, name);
      showToast("Workflow triggered.");
      await loadRuns(startDate, endDate);
    } catch (e) { setError(e.message); }
    finally { setRunning(false); }
  };

  return (
    <div>
      <div style={s.header}>
        <div>
          <div style={s.title}>{name}</div>
          <div style={s.meta}>{site} &nbsp;/&nbsp; {rg}</div>
        </div>
        <div style={s.btnRow}>
          <button style={s.btn("default")} onClick={() => loadRuns(startDate, endDate)}><RefreshCw size={14} /> Refresh</button>
          {isAdmin() && workflowState !== "Disabled" && (
            <button style={s.btn("run")} onClick={runWorkflow} disabled={running}>
              <Play size={14} />{running ? "Running..." : "Run"}
            </button>
          )}
          {isAdmin() && (
            <button style={s.btn(workflowState === "Disabled" ? "primary" : "danger")} onClick={toggleWorkflow} disabled={toggling}>
              {workflowState === "Disabled" ? <><Play size={14} /> Enable</> : <><Pause size={14} /> Disable</>}
            </button>
          )}
        </div>
      </div>

      {error && <div style={s.err}>{error}</div>}

      <MetadataPanel
        metadata={metadata} editing={editingMeta} form={metaForm}
        saving={savingMeta}
        onEdit={() => { setMetaForm({ ...metadata }); setEditingMeta(true); }}
        onCancel={() => setEditingMeta(false)}
        onSave={saveMeta}
        onChange={(k, v) => setMetaForm(f => ({ ...f, [k]: v }))}
      />

      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 16px",
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMute, whiteSpace: "nowrap" }}>
          Date Range
        </span>
        <input
          type="date" value={pendingStart} max={pendingEnd}
          onChange={e => setPendingStart(e.target.value)}
          style={{ background: "#042d44", border: `1px solid ${C.border}`, borderRadius: 4, color: C.textPri, padding: "5px 8px", fontSize: 12, outline: "none", colorScheme: "dark" }}
        />
        <span style={{ color: C.textMute, fontSize: 12 }}>to</span>
        <input
          type="date" value={pendingEnd} min={pendingStart}
          onChange={e => setPendingEnd(e.target.value)}
          style={{ background: "#042d44", border: `1px solid ${C.border}`, borderRadius: 4, color: C.textPri, padding: "5px 8px", fontSize: 12, outline: "none", colorScheme: "dark" }}
        />
        <button onClick={applyFilter} disabled={loading} style={{
          padding: "5px 16px", borderRadius: 4, border: "none", background: C.blue,
          color: "#0c2536", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>
          Apply
        </button>
        {!loading && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.textMute }}>
            {runs.length} run{runs.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div style={s.panel}>
        {loading ? (
          <div style={s.empty}>Loading runs...</div>
        ) : runs.length === 0 ? (
          <div style={s.empty}>No runs found for this date range.</div>
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

const CRITICALITY_OPTS = ["", "Low", "Medium", "High", "Critical"];

function CriticalityBadge({ value }) {
  if (!value) return <span style={{ color: "#444", fontSize: 12 }}>—</span>;
  const styles = {
    Low:      { background: "#0a3a1a", color: "#4ade80" },
    Medium:   { background: "#2d2000", color: "#fbbf24" },
    High:     { background: "#2c1200", color: "#fb923c" },
    Critical: { background: "#2c0808", color: "#f87171" },
  };
  const st = styles[value] || { background: C.surface, color: C.textSec };
  return (
    <span style={{
      display: "inline-block", fontSize: 11, fontWeight: 700, padding: "3px 10px",
      borderRadius: 999, letterSpacing: "0.04em", textTransform: "uppercase", ...st,
    }}>{value}</span>
  );
}

function MetadataPanel({ metadata: m, editing, form, saving, onEdit, onCancel, onSave, onChange }) {
  const inp = (key, placeholder = "") => (
    <input
      value={form[key] || ""}
      onChange={e => onChange(key, e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", background: "#042d44", border: `1px solid ${C.border}`, borderRadius: 4,
        color: C.textPri, padding: "5px 8px", fontSize: 12, outline: "none",
      }}
    />
  );

  const label = (text) => (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textMute, marginBottom: 3 }}>
      {text}
    </div>
  );

  const val = (text, isEmail) => {
    if (!text) return <span style={{ color: "#444", fontSize: 12 }}>—</span>;
    if (isEmail) return <a href={`mailto:${text}`} style={{ color: C.blue, fontSize: 12 }} onClick={e => e.stopPropagation()}>{text}</a>;
    return <span style={{ color: C.textSec, fontSize: 13 }}>{text}</span>;
  };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "16px 20px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textMute }}>
          Integration Metadata
        </span>
        {isAdmin() && !editing && (
          <button onClick={onEdit} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "4px 12px", borderRadius: 4,
            border: `1px solid ${C.border}`, background: "transparent", color: C.textSec,
            fontSize: 12, cursor: "pointer",
          }}>
            <Pencil size={11} /> Edit
          </button>
        )}
        {isAdmin() && editing && (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={onCancel} style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 4,
              border: `1px solid ${C.border}`, background: "transparent", color: C.textSec, fontSize: 12, cursor: "pointer",
            }}>
              <X size={11} /> Cancel
            </button>
            <button onClick={onSave} disabled={saving} style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 12px", borderRadius: 4,
              border: "none", background: C.green, color: "#0c2536", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>
              <Check size={11} /> {saving ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </div>

      {/* Description — full width */}
      <div style={{ marginBottom: 14 }}>
        {label("Description")}
        {editing ? inp("description", "What does this integration do?") : val(m.description)}
      </div>

      {/* 2-column grid for the rest */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 32px" }}>
        <div>
          {label("Subject Matter Expert")}
          {editing ? inp("sme_name", "Name") : val(m.sme_name)}
          {editing
            ? <div style={{ marginTop: 4 }}>{inp("sme_email", "Email")}</div>
            : val(m.sme_email, true)}
        </div>
        <div>
          {label("Business Owner")}
          {editing ? inp("business_owner_name", "Name") : val(m.business_owner_name)}
          {editing
            ? <div style={{ marginTop: 4 }}>{inp("business_owner_email", "Email")}</div>
            : val(m.business_owner_email, true)}
        </div>
        <div>
          {label("Team / Department")}
          {editing ? inp("team", "e.g. Revenue Operations") : val(m.team)}
        </div>
        <div>
          {label("Criticality")}
          {editing ? (
            <select
              value={form.criticality || ""}
              onChange={e => onChange("criticality", e.target.value)}
              style={{
                background: "#042d44", border: `1px solid ${C.border}`, borderRadius: 4,
                color: C.textPri, padding: "5px 8px", fontSize: 12, outline: "none", cursor: "pointer",
              }}
            >
              {CRITICALITY_OPTS.map(o => <option key={o} value={o}>{o || "— Select —"}</option>)}
            </select>
          ) : <CriticalityBadge value={m.criticality} />}
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          {label("Notes")}
          {editing ? (
            <textarea
              value={form.notes || ""}
              onChange={e => onChange("notes", e.target.value)}
              placeholder="IT notes, schedule info, downstream systems..."
              rows={2}
              style={{
                width: "100%", background: "#042d44", border: `1px solid ${C.border}`, borderRadius: 4,
                color: C.textPri, padding: "5px 8px", fontSize: 12, outline: "none", resize: "vertical",
              }}
            />
          ) : val(m.notes)}
        </div>
      </div>
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
