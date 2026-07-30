import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "../api/client";
import { formatDistanceToNow } from "date-fns";

const C = {
  surface: "#063c59", hover: "#0a4a6e", border: "#0e5278",
  blue: "#7dc3cd", green: "#c3d735", orange: "#e27124", gold: "#f7bc55",
  textPri: "#ffffff", textSec: "#cdd0d0", textMute: "#7dc3cd",
};

const s = {
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: C.textPri, marginBottom: 4 },
  meta: { fontSize: 13, color: C.textMute },
  btn: {
    padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
    display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`,
    background: C.surface, color: C.textSec,
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
  note: { fontSize: 12, color: C.textMute, marginTop: 8 },
};

function rateColor(rate) {
  if (rate == null) return C.textMute;
  if (rate >= 95) return C.green;
  if (rate >= 80) return C.gold;
  return C.orange;
}

export default function FunctionAppDetail() {
  const { subId, rg, appName } = useParams();
  const navigate = useNavigate();
  const [functions, setFunctions] = useState([]);
  const [meta, setMeta] = useState(null); // {appId, roleName}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.getFunctionsInApp(subId, rg, appName);
      setFunctions(data.functions || []);
      if (data.appId) setMeta({ appId: data.appId, roleName: data.roleName });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [subId, rg, appName]);

  useEffect(() => { load(); }, [load]);

  const openFn = (fnName) =>
    navigate(`/function-app/${subId}/${rg}/${appName}/fn/${encodeURIComponent(fnName)}`);

  return (
    <div>
      <div style={s.header}>
        <div>
          <div style={s.title}>{appName}</div>
          <div style={s.meta}>{rg} &nbsp;·&nbsp; {subId.slice(0, 8)}…</div>
        </div>
        <button style={s.btn} onClick={load}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <div style={s.err}>{error}</div>}

      <div style={{ ...s.panel, overflowX: "auto" }}>
        {loading ? (
          <div style={s.empty}>Loading functions…</div>
        ) : functions.length === 0 ? (
          <div style={s.empty}>
            <div>No functions found in the last 30 days.</div>
            {meta && (
              <div style={{ fontSize: 11, marginTop: 12, color: C.textMute, fontFamily: "monospace" }}>
                <div>App Insights: {meta.appId}</div>
                <div>cloud_RoleName filter: {meta.roleName}</div>
                {meta.roleName !== appName && (
                  <div style={{ marginTop: 4, color: C.gold }}>
                    Role name differs from app name — set via AZURE_FUNCTION_ROLE_OVERRIDES
                  </div>
                )}
                {meta.roleName === appName && (
                  <div style={{ marginTop: 4 }}>
                    If the app has runs, check the portal: Logs → requests | where cloud_RoleName =~ &apos;{meta.roleName}&apos;
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                {["Function", "Last Run", "Total Runs (30d)", "Success Rate"].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {functions.map((fn, i) => (
                <FnRow key={i} fn={fn} onClick={() => openFn(fn.fnName)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!loading && functions.length > 0 && (
        <div style={s.note}>Stats based on last 30 days of Application Insights data.</div>
      )}
    </div>
  );
}

function FnRow({ fn, onClick }) {
  const [hovered, setHovered] = useState(false);
  const ts = fn.lastRun ? new Date(fn.lastRun) : null;
  const rate = fn.successRate;
  return (
    <tr
      style={{ ...s.tr, background: hovered ? C.hover : "" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <td style={{ ...s.td, color: C.blue, fontWeight: 600 }}>{fn.fnName || "—"}</td>
      <td style={{ ...s.td, fontSize: 13 }}>
        {ts ? <span title={ts.toISOString()}>{formatDistanceToNow(ts, { addSuffix: true })}</span> : "—"}
      </td>
      <td style={{ ...s.td, fontSize: 13 }}>{fn.totalRuns?.toLocaleString() ?? "—"}</td>
      <td style={{ ...s.td, fontSize: 13, fontWeight: 600, color: rateColor(rate) }}>
        {rate != null ? `${rate}%` : "—"}
      </td>
    </tr>
  );
}
