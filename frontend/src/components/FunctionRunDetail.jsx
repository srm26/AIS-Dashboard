import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "../api/client";
import StatusBadge from "./StatusBadge";
import { format } from "date-fns";

const C = {
  surface: "#063c59", hover: "#0a4a6e", border: "#0e5278",
  blue: "#7dc3cd", green: "#c3d735", orange: "#e27124", gold: "#f7bc55",
  red: "#e05555", purple: "#9b7ec8",
  textPri: "#ffffff", textSec: "#cdd0d0", textMute: "#7dc3cd",
};

const SEVERITY = {
  0: { label: "Verbose", color: "#7a8a9a" },
  1: { label: "Info",    color: C.blue },
  2: { label: "Warning", color: C.gold },
  3: { label: "Error",   color: C.orange },
  4: { label: "Critical",color: C.red },
};

const TRIGGER_COLORS = {
  Timer: "#7b5ea7", Http: "#1a7aaa", Blob: "#1a8a7a",
  Queue: "#2a7a3a", ServiceBus: "#c87020", EventHub: "#b07010",
};

const s = {
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: C.textPri, marginBottom: 4 },
  meta: { fontSize: 13, color: C.textMute },
  backBtn: {
    display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 6,
    cursor: "pointer", fontSize: 13, fontWeight: 600, border: `1px solid ${C.border}`,
    background: C.surface, color: C.textSec,
  },
  card: {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
    marginBottom: 20, overflow: "hidden",
  },
  cardHead: {
    padding: "10px 16px", borderBottom: `1px solid ${C.border}`,
    fontSize: 12, fontWeight: 700, color: C.textMute,
    textTransform: "uppercase", letterSpacing: "0.07em",
  },
  cardBody: { padding: "16px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 },
  kv: { display: "flex", flexDirection: "column", gap: 3 },
  kvLabel: { fontSize: 11, color: C.textMute, textTransform: "uppercase", letterSpacing: "0.05em" },
  kvVal: { fontSize: 13, color: C.textSec, wordBreak: "break-all" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left", padding: "8px 14px", fontSize: 11, color: C.textMute,
    borderBottom: `1px solid ${C.border}`, textTransform: "uppercase",
    letterSpacing: "0.06em", fontWeight: 600,
  },
  tr: { borderBottom: `1px solid ${C.border}` },
  td: { padding: "10px 14px", fontSize: 13, color: C.textSec },
  empty: { textAlign: "center", padding: 32, color: C.textMute, fontSize: 13 },
  err: {
    background: "#3a1a0a", color: C.orange, borderRadius: 6,
    padding: "10px 16px", marginBottom: 16, fontSize: 13, border: `1px solid ${C.orange}44`,
  },
  mono: { fontFamily: "monospace", fontSize: 12 },
  pre: {
    background: "#021820", border: `1px solid ${C.border}`, borderRadius: 4,
    padding: "10px 12px", fontSize: 12, color: C.textSec, overflowX: "auto",
    whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: 6,
  },
};

function parseDims(d) {
  if (!d) return {};
  if (typeof d === "string") { try { return JSON.parse(d); } catch { return {}; } }
  return d;
}

function TriggerChip({ type }) {
  if (!type) return null;
  const key = Object.keys(TRIGGER_COLORS).find(k => type.toLowerCase().includes(k.toLowerCase())) || "";
  const bg = TRIGGER_COLORS[key] || "#2a3a4a";
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
      background: bg, color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em",
    }}>{type}</span>
  );
}

function KV({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div style={s.kv}>
      <span style={s.kvLabel}>{label}</span>
      <span style={s.kvVal}>{value}</span>
    </div>
  );
}

export default function FunctionRunDetail() {
  const { subId, rg, appName, fnName, operationId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [excExpanded, setExcExpanded] = useState({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await api.getFunctionRunDetail(subId, rg, appName, operationId);
      setData(result);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [subId, rg, appName, operationId]);

  useEffect(() => { load(); }, [load]);

  const back = () =>
    navigate(`/function-app/${subId}/${rg}/${appName}/fn/${encodeURIComponent(fnName)}`);

  if (loading) return <div style={{ ...s.empty, padding: 80 }}>Loading run detail…</div>;
  if (error) return <div style={s.err}>{error}</div>;
  if (!data) return null;

  const { request, traces, exceptions, dependencies } = data;
  const dims = parseDims(request?.customDimensions);
  const triggerType = dims.TriggerType || "";
  const invocationId = dims.InvocationId || "";
  const ts = request?.timestamp ? new Date(request.timestamp) : null;
  const status = request?.success ? "Succeeded" : "Failed";
  const dur = typeof request?.duration === "number" ? Math.round(request.duration) : null;

  // Parse HTTP method + path from operation name (e.g. "POST /api/trigger")
  const opName = request?.name || "";
  const httpMatch = opName.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(.+)$/i);

  return (
    <div>
      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={s.title}>{fnName}</div>
          <div style={s.meta}>
            {appName} &nbsp;·&nbsp;
            {ts ? format(ts, "PPpp") : ""}
          </div>
        </div>
        <button style={s.backBtn} onClick={back}>
          <ArrowLeft size={14} /> Back to runs
        </button>
      </div>

      {/* Status strip */}
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <StatusBadge status={status} />
        {dur !== null && (
          <span style={{ fontSize: 13, color: C.textMute }}>{dur.toLocaleString()} ms</span>
        )}
        {invocationId && (
          <span style={{ ...s.mono, color: C.textMute, fontSize: 12 }}>
            Invocation: {invocationId}
          </span>
        )}
      </div>

      {/* Trigger & Caller */}
      <div style={s.card}>
        <div style={s.cardHead}>Trigger &amp; Caller</div>
        <div style={s.cardBody}>
          <div style={{ ...s.grid }}>
            <div style={s.kv}>
              <span style={s.kvLabel}>Trigger Type</span>
              <span><TriggerChip type={triggerType || "Unknown"} /></span>
            </div>
            {httpMatch && (
              <>
                <KV label="Method" value={httpMatch[1].toUpperCase()} />
                <KV label="Path" value={httpMatch[2]} />
              </>
            )}
            {!httpMatch && opName && <KV label="Operation" value={opName} />}
            {request?.url && <KV label="URL" value={request.url} />}
            {request?.client_IP && <KV label="Client IP" value={request.client_IP} />}
            {request?.resultCode && <KV label="Result Code" value={request.resultCode} />}
            {dims.TriggerDetails && <KV label="Trigger Details" value={dims.TriggerDetails} />}
            {/* Blob trigger info */}
            {dims.BlobTriggerPath && <KV label="Blob Path" value={dims.BlobTriggerPath} />}
            {/* ServiceBus trigger info */}
            {dims.MessageId && <KV label="Message ID" value={dims.MessageId} />}
            {dims.SequenceNumber && <KV label="Sequence #" value={dims.SequenceNumber} />}
          </div>
        </div>
      </div>

      {/* Logs */}
      <div style={s.card}>
        <div style={s.cardHead}>Logs ({traces.length})</div>
        {traces.length === 0 ? (
          <div style={s.empty}>No log entries for this invocation.</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Severity</th>
                <th style={s.th}>Time</th>
                <th style={s.th}>Message</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((t, i) => {
                const sev = SEVERITY[t.severityLevel] || SEVERITY[1];
                const tTs = t.timestamp ? new Date(t.timestamp) : null;
                return (
                  <tr key={i} style={s.tr}>
                    <td style={{ ...s.td, width: 80 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: sev.color }}>
                        {sev.label}
                      </span>
                    </td>
                    <td style={{ ...s.td, fontSize: 11, color: C.textMute, whiteSpace: "nowrap", width: 160 }}>
                      {tTs ? format(tTs, "HH:mm:ss.SSS") : "—"}
                    </td>
                    <td style={{ ...s.td, ...s.mono, wordBreak: "break-all" }}>{t.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Exceptions */}
      {exceptions.length > 0 && (
        <div style={s.card}>
          <div style={s.cardHead}>Exceptions ({exceptions.length})</div>
          <div style={s.cardBody}>
            {exceptions.map((ex, i) => (
              <div key={i} style={{ marginBottom: i < exceptions.length - 1 ? 16 : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.orange }}>{ex.type}</span>
                  {ex.timestamp && (
                    <span style={{ fontSize: 11, color: C.textMute }}>
                      {format(new Date(ex.timestamp), "HH:mm:ss.SSS")}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: C.textSec, marginBottom: 4 }}>
                  {ex.outerMessage || ex.innermostMessage}
                </div>
                {ex.innermostMessage && ex.innermostMessage !== ex.outerMessage && (
                  <div style={{ fontSize: 12, color: C.textMute }}>{ex.innermostMessage}</div>
                )}
                {ex.details && (
                  <div>
                    <button
                      onClick={() => setExcExpanded(p => ({ ...p, [i]: !p[i] }))}
                      style={{ fontSize: 11, color: C.blue, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}
                    >
                      {excExpanded[i] ? "Hide stack trace" : "Show stack trace"}
                    </button>
                    {excExpanded[i] && (
                      <pre style={s.pre}>
                        {typeof ex.details === "string"
                          ? ex.details
                          : JSON.stringify(ex.details, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dependencies */}
      {dependencies.length > 0 && (
        <div style={s.card}>
          <div style={s.cardHead}>Outbound Calls ({dependencies.length})</div>
          <table style={s.table}>
            <thead>
              <tr>
                {["Type", "Name / Target", "Status", "Duration (ms)", "Result"].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dependencies.map((dep, i) => {
                const depStatus = dep.success ? "Succeeded" : "Failed";
                const depDur = typeof dep.duration === "number" ? Math.round(dep.duration) : null;
                return (
                  <tr key={i} style={s.tr}>
                    <td style={{ ...s.td, fontSize: 11 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                        background: "#1a2a3a", color: C.textMute, textTransform: "uppercase",
                      }}>{dep.type || "??"}</span>
                    </td>
                    <td style={{ ...s.td, ...s.mono, fontSize: 12 }}>
                      <div>{dep.name}</div>
                      {dep.target && dep.target !== dep.name && (
                        <div style={{ color: C.textMute, fontSize: 11 }}>{dep.target}</div>
                      )}
                      {dep.data && (
                        <div style={{ color: C.textMute, fontSize: 11, marginTop: 2 }}>{dep.data}</div>
                      )}
                    </td>
                    <td style={s.td}><StatusBadge status={depStatus} /></td>
                    <td style={{ ...s.td, fontSize: 13 }}>{depDur !== null ? depDur.toLocaleString() : "—"}</td>
                    <td style={{ ...s.td, fontSize: 12, color: C.textMute }}>{dep.resultCode || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
