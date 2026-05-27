import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Search, CheckCircle, XCircle, Activity } from "lucide-react";
import { api } from "../api/client";
import StatusBadge from "./StatusBadge";
import { formatDistanceToNow, format } from "date-fns";

const C = {
  surface:  "#063c59", hover: "#0a4a6e", border: "#0e5278",
  blue: "#7dc3cd", green: "#c3d735", orange: "#e27124", gold: "#f7bc55",
  textPri: "#ffffff", textSec: "#cdd0d0", textMute: "#7dc3cd",
};

const selectStyle = {
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
  color: C.textPri, padding: "7px 32px 7px 12px", fontSize: 13, outline: "none",
  cursor: "pointer", minWidth: 200,
  appearance: "none", WebkitAppearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237dc3cd' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
};

const s = {
  grid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 28 },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "20px 24px" },
  cardLabel: { fontSize: 11, color: C.textMute, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 },
  cardValue: { fontSize: 34, fontWeight: 700 },
  toolbar: { display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" },
  searchWrap: { position: "relative", flex: 1, minWidth: 200 },
  searchIcon: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.textMute },
  input: {
    width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
    color: C.textPri, padding: "8px 12px 8px 34px", fontSize: 13, outline: "none",
  },
  filterBtn: (active) => ({
    padding: "7px 16px", borderRadius: 6, border: `1px solid ${active ? C.blue : C.border}`,
    cursor: "pointer", fontSize: 13, fontWeight: 500,
    background: active ? C.blue : C.surface, color: active ? "#0c2536" : C.textSec,
  }),
  refreshBtn: {
    padding: "7px 14px", borderRadius: 6, border: `1px solid ${C.border}`, cursor: "pointer",
    background: C.surface, color: C.textSec, display: "flex", alignItems: "center", gap: 6, fontSize: 13,
  },
  panel: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "10px 16px", fontSize: 11, color: C.textMute, borderBottom: `1px solid ${C.border}`, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },
  tr: { borderBottom: `1px solid ${C.border}`, cursor: "pointer" },
  td: { padding: "13px 16px", fontSize: 14, color: C.textSec },
  empty: { textAlign: "center", padding: 56, color: C.textMute },
  err: { background: "#3a1a0a", color: C.orange, borderRadius: 6, padding: "10px 16px", marginBottom: 16, fontSize: 13, border: `1px solid ${C.orange}44` },
};

const STATE_FILTERS = ["All", "Enabled", "Disabled"];

export default function Dashboard() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState([]);
  const [lastRuns, setLastRuns] = useState({});
  const [lastRunsLoading, setLastRunsLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("All");
  const [selectedSub, setSelectedSub] = useState("");
  const [selectedSite, setSelectedSite] = useState("");

  const loadWorkflows = useCallback(async () => {
    setLoading(true); setLastRunsLoading(true); setError(null);
    try {
      const data = await api.getWorkflows();
      setWorkflows(data.workflows || []);
      if (data.errors?.length) setError(data.errors.map(e => `${e.site || e.subscriptionId}: ${e.error}`).join(" | "));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
    // Load last-run data in the background — table is already visible
    try {
      const runs = await api.getLastRuns();
      setLastRuns(runs);
    } catch {}
    finally { setLastRunsLoading(false); }
  }, []);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try { setSummary(await api.getSummary()); }
    catch {} finally { setSummaryLoading(false); }
  }, []);

  const loadSubscriptions = useCallback(async () => {
    try { setSubscriptions((await api.getSubscriptions()).subscriptions || []); }
    catch {}
  }, []);

  useEffect(() => {
    loadWorkflows();
    loadSummary();
    loadSubscriptions();
  }, [loadWorkflows, loadSummary, loadSubscriptions]);

  // When subscription changes, reset site filter
  const handleSubChange = (val) => { setSelectedSub(val); setSelectedSite(""); };

  // Sites available for the selected subscription (or all)
  const availableSites = useMemo(() => {
    const pool = selectedSub ? workflows.filter(w => w.subscriptionId === selectedSub) : workflows;
    return [...new Set(pool.map(w => w.siteName))].sort();
  }, [workflows, selectedSub]);

  const filtered = useMemo(() => workflows.filter(wf => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      wf.name.toLowerCase().includes(q) ||
      wf.siteName.toLowerCase().includes(q) ||
      wf.resourceGroup.toLowerCase().includes(q);
    const matchSub  = !selectedSub  || wf.subscriptionId === selectedSub;
    const matchSite = !selectedSite || wf.siteName === selectedSite;
    const matchState = stateFilter === "All" || wf.state === stateFilter;
    return matchSearch && matchSub && matchSite && matchState;
  }), [workflows, search, selectedSub, selectedSite, stateFilter]);

  const refresh = () => { loadWorkflows(); loadSummary(); setLastRuns({}); };

  return (
    <div>
      <div style={s.grid}>
        <SummaryCard label="Total Workflows"  value={summary?.total ?? "-"}       loading={summaryLoading} accent={C.blue} />
        <SummaryCard label="Enabled"          value={summary?.enabled ?? "-"}     loading={summaryLoading} accent={C.green} />
        <SummaryCard label="Runs Today"       value={summary?.runsToday ?? "-"}   loading={summaryLoading} accent={C.gold} />
        <SummaryCard label="Failed Today"     value={summary?.failedToday ?? "-"} loading={summaryLoading} accent={C.orange} />
      </div>

      {error && <div style={s.err}>{error}</div>}

      <div style={s.toolbar}>
        {/* Subscription dropdown */}
        <div style={{ position: "relative" }}>
          <select style={selectStyle} value={selectedSub} onChange={e => handleSubChange(e.target.value)}>
            <option value="">All Subscriptions</option>
            {subscriptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Logic App (site) dropdown */}
        <div style={{ position: "relative" }}>
          <select style={{ ...selectStyle, minWidth: 220 }} value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
            <option value="">All Logic Apps</option>
            {availableSites.map(site => <option key={site} value={site}>{site}</option>)}
          </select>
        </div>

        {/* Search */}
        <div style={s.searchWrap}>
          <Search size={14} style={s.searchIcon} />
          <input style={s.input} placeholder="Search workflows..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* State filters */}
        {STATE_FILTERS.map(f => (
          <button key={f} style={s.filterBtn(stateFilter === f)} onClick={() => setStateFilter(f)}>{f}</button>
        ))}

        <button style={s.refreshBtn} onClick={refresh}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div style={s.panel}>
        {loading ? (
          <div style={s.empty}>Loading workflows...</div>
        ) : filtered.length === 0 ? (
          <div style={s.empty}>No workflows found.</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                {["Workflow", "Logic App", "Subscription", "State", "Last Run", "Last Run Status"].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(wf => {
                const lr = lastRuns[wf.id];
                const lastRunTime = lr?.lastRunTime;
                const lastRunStatus = lr?.lastRunStatus;
                return (
                  <tr key={wf.id} style={s.tr}
                    onClick={() => navigate(`/workflow/${wf.subscriptionId}/${wf.resourceGroup}/${wf.siteName}/${wf.name}`)}
                    onMouseEnter={e => e.currentTarget.style.background = C.hover}
                    onMouseLeave={e => e.currentTarget.style.background = ""}
                  >
                    <td style={{ ...s.td, color: C.blue, fontWeight: 600 }}>{wf.name}</td>
                    <td style={s.td}>{wf.siteName}</td>
                    <td style={{ ...s.td, fontSize: 13 }}>{wf.subscriptionName || wf.subscriptionId.slice(0, 8) + "..."}</td>
                    <td style={s.td}><StatusBadge status={wf.state} /></td>
                    <td style={{ ...s.td, fontSize: 12, color: C.textMute }}>
                      {lastRunsLoading && !lr
                        ? <span style={{ color: "#444" }}>...</span>
                        : lastRunTime
                          ? <span title={format(new Date(lastRunTime), "PPpp")}>
                              {formatDistanceToNow(new Date(lastRunTime), { addSuffix: true })}
                            </span>
                          : <span style={{ color: "#444" }}>No runs</span>}
                    </td>
                    <td style={s.td}>
                      {lastRunsLoading && !lr
                        ? <span style={{ color: "#444" }}>...</span>
                        : lastRunStatus ? <StatusBadge status={lastRunStatus} /> : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, loading, accent }) {
  return (
    <div style={{ ...s.card, borderTop: `3px solid ${accent}` }}>
      <div style={s.cardLabel}>{label}</div>
      <div style={{ ...s.cardValue, color: accent }}>{loading ? "..." : value}</div>
    </div>
  );
}
