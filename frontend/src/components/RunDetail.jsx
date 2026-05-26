import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../api/client";
import StatusBadge from "./StatusBadge";
import { format } from "date-fns";

const C = {
  surface: "#063c59", surfaceDeep: "#0c2536", hover: "#0a4a6e", border: "#0e5278",
  blue: "#7dc3cd", green: "#c3d735", orange: "#e27124", gold: "#f7bc55",
  textPri: "#ffffff", textSec: "#cdd0d0", textMute: "#7dc3cd",
};

const s = {
  title: { fontSize: 20, fontWeight: 700, color: C.textPri, marginBottom: 4 },
  meta: { fontSize: 13, color: C.textMute, marginBottom: 24 },
  empty: { textAlign: "center", padding: 56, color: C.textMute },
  err: { background: "#3a1a0a", color: C.orange, borderRadius: 6, padding: "10px 16px", marginBottom: 16, fontSize: 13, border: `1px solid ${C.orange}44` },
  actionRow: { borderBottom: `1px solid ${C.border}`, background: C.surface },
  actionHeader: { display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer" },
  actionName: { fontSize: 14, color: C.textPri, fontWeight: 500, flex: 1 },
  actionMeta: { fontSize: 12, color: C.textMute },
  payload: {
    margin: "0 16px 12px 16px", background: C.surfaceDeep, border: `1px solid ${C.border}`,
    borderRadius: 6, padding: 16, fontSize: 12, fontFamily: "monospace", color: C.textSec,
    overflow: "auto", maxHeight: 420, whiteSpace: "pre",
  },
  tab: (active) => ({
    padding: "6px 18px", border: `1px solid ${C.border}`, cursor: "pointer", fontSize: 12, fontWeight: 600,
    background: active ? C.blue : C.surface, color: active ? "#0c2536" : C.textSec,
  }),
};

function duration(start, end) {
  if (!start || !end) return "";
  const ms = new Date(end) - new Date(start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function ActionRow({ action, subId, rg, site, name, runName }) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState(null);
  const [payloadLoading, setPayloadLoading] = useState(false);
  const [tab, setTab] = useState("inputs");

  const loadPayload = async () => {
    if (payload) return;
    setPayloadLoading(true);
    try { setPayload(await api.getPayload(subId, rg, site, name, runName, action.name)); }
    catch (e) { setPayload({ error: e.message }); }
    finally { setPayloadLoading(false); }
  };

  const toggle = () => { if (!open) loadPayload(); setOpen(o => !o); };
  const content = payload ? (tab === "inputs" ? payload.inputs : payload.outputs) : null;

  const statusColor = { Succeeded: C.green, Failed: C.orange, Running: C.blue, Skipped: C.textMute }[action.status] || C.textMute;

  return (
    <div style={{ ...s.actionRow, borderLeft: `3px solid ${statusColor}` }}>
      <div style={s.actionHeader} onClick={toggle}
        onMouseEnter={e => e.currentTarget.parentElement.style.background = C.hover}
        onMouseLeave={e => e.currentTarget.parentElement.style.background = C.surface}
      >
        {open
          ? <ChevronDown size={14} color={C.textMute} />
          : <ChevronRight size={14} color={C.textMute} />}
        <span style={s.actionName}>{action.name}</span>
        <StatusBadge status={action.status} />
        {action.startTime && (
          <span style={s.actionMeta}>
            {format(new Date(action.startTime), "HH:mm:ss")}
            {action.endTime && ` / ${duration(action.startTime, action.endTime)}`}
          </span>
        )}
      </div>
      {open && (
        <div style={{ paddingBottom: 8 }}>
          {action.error && (
            <div style={{ margin: "0 16px 8px 16px", background: "#3a1a0a", color: C.orange, borderRadius: 6, padding: "8px 12px", fontSize: 12, border: `1px solid ${C.orange}44` }}>
              {JSON.stringify(action.error, null, 2)}
            </div>
          )}
          <div style={{ margin: "0 16px 8px 16px" }}>
            <div style={{ display: "flex", marginBottom: 10 }}>
              {["inputs", "outputs"].map(t => <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>{t}</button>)}
            </div>
            <div style={s.payload}>
              {payloadLoading ? "Loading payload..." : content != null ? JSON.stringify(content, null, 2) : "No data"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RunDetail() {
  const { subId, rg, site, name, runName } = useParams();
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setActions((await api.getActions(subId, rg, site, name, runName)).actions || []); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [subId, rg, site, name, runName]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={s.title}>Run: {runName}</div>
      <div style={s.meta}>{name} / {site} / {rg}</div>
      {error && <div style={s.err}>{error}</div>}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
        {loading ? <div style={s.empty}>Loading actions...</div>
          : actions.length === 0 ? <div style={s.empty}>No actions found.</div>
          : actions.map(a => <ActionRow key={a.id} action={a} subId={subId} rg={rg} site={site} name={name} runName={runName} />)}
      </div>
    </div>
  );
}
