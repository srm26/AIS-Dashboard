import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Search, CheckCircle, XCircle, Activity, Play, Upload, Download, Bookmark, X } from "lucide-react";
import { api } from "../api/client";
import { isAdmin, getUser } from "../auth";
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


// Persist data across remounts so dropdowns and counts are never blank on back-navigation
let _subsCache = [];
let _wfCache = [];

function getSavedFilters() {
  try { return JSON.parse(sessionStorage.getItem("ais_filters") || "{}"); } catch { return {}; }
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState(_wfCache);
  const [lastRuns, setLastRuns] = useState({});
  const [lastRunsLoading, setLastRunsLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState(_subsCache);
  const [summary, setSummary] = useState(null);
  const failedWorkflowIds = useMemo(() => new Set(summary?.failedWorkflowIds || []), [summary]);
  const [loading, setLoading] = useState(_wfCache.length === 0);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("All");
  const [failedTodayFilter, setFailedTodayFilter] = useState(false);
  const saved = getSavedFilters();
  const [selectedSub, setSelectedSub] = useState(Array.isArray(saved.sub) ? saved.sub : (saved.sub ? [saved.sub] : []));
  const [selectedSite, setSelectedSite] = useState(saved.site || "");
  const currentUser = useMemo(() => getUser(), []);
  const [views, setViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);

  const loadWorkflows = useCallback(async () => {
    setLoading(true); setLastRunsLoading(true); setError(null);
    try {
      const data = await api.getWorkflows();
      const wfs = data.workflows || [];
      _wfCache = wfs;
      setWorkflows(wfs);
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

  const summarySeq = useRef(0);
  const loadSummary = useCallback(async (subIds = [], siteName = "") => {
    const seq = ++summarySeq.current;
    setSummaryLoading(true);
    try {
      let data;
      if (subIds.length <= 1) {
        data = await api.getSummary(subIds[0] || "", siteName);
      } else {
        const results = await Promise.all(subIds.map(id => api.getSummary(id, siteName)));
        data = {
          runsToday: results.reduce((sum, r) => sum + (r.runsToday || 0), 0),
          failedToday: results.reduce((sum, r) => sum + (r.failedToday || 0), 0),
          failedWorkflowIds: results.flatMap(r => r.failedWorkflowIds || []),
        };
      }
      if (seq === summarySeq.current) setSummary(data);
    } catch {}
    finally { if (seq === summarySeq.current) setSummaryLoading(false); }
  }, []);

  const loadSubscriptions = useCallback(async () => {
    try {
      const subs = (await api.getSubscriptions()).subscriptions || [];
      _subsCache = subs;
      setSubscriptions(subs);
    } catch {}
  }, []);

  const applyView = useCallback((view) => {
    setSelectedSub(view.filters.subscriptions || []);
    setSelectedSite(view.filters.site || "");
    setSearch(view.filters.search || "");
    setStateFilter(view.filters.stateFilter || "All");
    setFailedTodayFilter(false);
    setActiveViewId(view.id);
  }, []);

  const loadViews = useCallback(async () => {
    try { return (await api.getViews()) || []; }
    catch { return []; }
  }, []);

  const handleSaveView = useCallback(async (data) => {
    const saved = await api.createView(data);
    setViews(vs => [...vs, saved]);
    if (data.isDefault) setActiveViewId(saved.id);
  }, []);

  const handleSetDefault = useCallback(async (viewId) => {
    try {
      const result = await api.setDefaultView(viewId);
      const username = getUser()?.username;
      setViews(vs => vs.map(v =>
        v.owner === username ? { ...v, isDefault: v.id === viewId ? result.isDefault : false } : v
      ));
    } catch (e) { alert(`Failed: ${e.message}`); }
  }, []);

  const handleDeleteView = useCallback(async (viewId) => {
    try {
      await api.deleteView(viewId);
      setViews(vs => vs.filter(v => v.id !== viewId));
      setActiveViewId(prev => prev === viewId ? null : prev);
    } catch (e) { alert(`Failed: ${e.message}`); }
  }, []);

  useEffect(() => {
    loadWorkflows();
    loadSubscriptions();
    loadViews().then(vs => {
      setViews(vs);
      const username = getUser()?.username;
      const def = username && vs.find(v => v.owner === username && v.isDefault);
      if (def) applyView(def);
    });
  }, [loadWorkflows, loadSubscriptions, loadViews, applyView]);

  // Persist filter selections so they survive back-navigation
  useEffect(() => {
    sessionStorage.setItem("ais_filters", JSON.stringify({ sub: selectedSub, site: selectedSite }));
  }, [selectedSub, selectedSite]);

  // Refresh summary counts whenever subscription or site filter changes
  useEffect(() => {
    loadSummary(selectedSub, selectedSite);
  }, [selectedSub, selectedSite, loadSummary]);

  // When subscription changes, reset site filter and clear active view
  const handleSubChange = (val) => { setSelectedSub(val); setSelectedSite(""); setActiveViewId(null); };
  const handleSiteChange = (val) => { setSelectedSite(val); setActiveViewId(null); };

  // Sites available for the selected subscriptions (or all)
  const availableSites = useMemo(() => {
    const pool = selectedSub.length ? workflows.filter(w => selectedSub.includes(w.subscriptionId)) : workflows;
    return [...new Set(pool.map(w => w.siteName))].sort();
  }, [workflows, selectedSub]);

  // Total and Enabled computed locally — no extra API call needed
  const subSiteWorkflows = useMemo(() =>
    workflows.filter(wf =>
      (!selectedSub.length || selectedSub.includes(wf.subscriptionId)) &&
      (!selectedSite || wf.siteName === selectedSite)
    ), [workflows, selectedSub, selectedSite]);

  const filtered = useMemo(() => subSiteWorkflows.filter(wf => {
    const q = search.toLowerCase();
    const m = wf.metadata || {};
    const matchSearch = !q ||
      wf.name.toLowerCase().includes(q) ||
      wf.siteName.toLowerCase().includes(q) ||
      wf.resourceGroup.toLowerCase().includes(q) ||
      (m.description || "").toLowerCase().includes(q) ||
      (m.sme_name || "").toLowerCase().includes(q) ||
      (m.business_owner_name || "").toLowerCase().includes(q) ||
      (m.team || "").toLowerCase().includes(q);
    const matchState = stateFilter === "All" || wf.state === stateFilter;
    if (!matchSearch || !matchState) return false;
    if (failedTodayFilter) return failedWorkflowIds.has(wf.id);
    return true;
  }), [subSiteWorkflows, search, stateFilter, failedTodayFilter, failedWorkflowIds]);

  const refresh = () => { loadWorkflows(); loadSummary(selectedSub, selectedSite); setLastRuns({}); };

  const importRef = useRef(null);
  const [importing, setImporting] = useState(false);

  const exportCSV = () => {
    const headers = ["workflow_id", "workflow_name", "site_name", "resource_group",
      "description", "sme_name", "sme_email", "business_owner_name", "business_owner_email",
      "team", "criticality", "notes"];
    const esc = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
    const rows = workflows.map(wf => {
      const m = wf.metadata || {};
      return [wf.id, wf.name, wf.siteName, wf.resourceGroup,
        m.description, m.sme_name, m.sme_email, m.business_owner_name,
        m.business_owner_email, m.team, m.criticality, m.notes].map(esc).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "workflow-metadata.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.importMetadataCSV(file);
      await loadWorkflows();
      alert(`Imported metadata for ${result.updated} workflow(s).`);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const [activeTab, setActiveTab] = useState("integrations");
  const [functionApps, setFunctionApps] = useState([]);
  const [functionLastRuns, setFunctionLastRuns] = useState({});
  const [fnLastRunsLoading, setFnLastRunsLoading] = useState(false);
  const [fnLoading, setFnLoading] = useState(false);
  const [fnError, setFnError] = useState(null);
  const [fnLoaded, setFnLoaded] = useState(false);
  const [fnSearch, setFnSearch] = useState("");

  const loadFunctionApps = useCallback(async () => {
    setFnLoading(true); setFnLastRunsLoading(true); setFnError(null);
    try {
      const data = await api.getFunctionApps();
      setFunctionApps(data.functions || []);
    } catch (e) { setFnError(e.message); }
    finally { setFnLoading(false); }
    try {
      const runs = await api.getFunctionAppLastRuns();
      setFunctionLastRuns(runs);
    } catch {}
    finally { setFnLastRunsLoading(false); }
  }, []);

  const handleTabChange = useCallback((key) => {
    setActiveTab(key);
    if (key === "function-apps" && !fnLoaded) {
      setFnLoaded(true);
      loadFunctionApps();
    }
  }, [fnLoaded, loadFunctionApps]);

  const TABS = ["Integrations", "Function Apps", "Data Products", "AI Agents"];

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: `1px solid ${C.border}` }}>
        {TABS.map(tab => {
          const key = tab.toLowerCase().replace(/ /g, "-");
          const active = activeTab === key;
          return (
            <button key={key} onClick={() => handleTabChange(key)} style={{
              padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer",
              background: "none", border: "none", borderBottom: active ? `2px solid ${C.blue}` : "2px solid transparent",
              color: active ? C.blue : C.textSec, marginBottom: -1,
            }}>
              {tab}
            </button>
          );
        })}
      </div>

      {activeTab === "integrations" && (
        <>
          <div style={s.grid}>
            <SummaryCard label="Total Workflows"  value={subSiteWorkflows.length}                                          loading={loading} accent={C.blue} />
            <SummaryCard label="Enabled"          value={subSiteWorkflows.filter(w => w.state !== "Disabled").length}    loading={loading} accent={C.green} />
            <SummaryCard label="Runs Today"       value={summary?.runsToday ?? "-"}                                      loading={summaryLoading} accent={C.gold} />
            <SummaryCard label="Failed Today"     value={summary?.failedToday ?? "-"}                                    loading={summaryLoading} accent={C.orange}
              active={failedTodayFilter} onClick={() => setFailedTodayFilter(v => !v)} />
          </div>

          {error && <div style={s.err}>{error}</div>}

          <div style={s.toolbar}>
            <ViewsDropdown
              views={views}
              currentUser={currentUser}
              activeViewId={activeViewId}
              onApply={applyView}
              onSetDefault={handleSetDefault}
              onDelete={handleDeleteView}
              onSave={handleSaveView}
              currentFilters={{ subscriptions: selectedSub, site: selectedSite, search, stateFilter }}
            />
            <MultiSelectDropdown
              options={subscriptions.map(s => ({ id: s.id, label: s.name }))}
              selected={selectedSub}
              onChange={handleSubChange}
              placeholder="All Subscriptions"
            />
            <div style={{ position: "relative" }}>
              <select style={{ ...selectStyle, minWidth: 220 }} value={selectedSite} onChange={e => handleSiteChange(e.target.value)}>
                <option value="">All Logic Apps</option>
                {availableSites.map(site => <option key={site} value={site}>{site}</option>)}
              </select>
            </div>
            <div style={s.searchWrap}>
              <Search size={14} style={s.searchIcon} />
              <input style={s.input} placeholder="Search workflows..." value={search}
                onChange={e => { setSearch(e.target.value); setActiveViewId(null); }} />
            </div>
            {STATE_FILTERS.map(f => (
              <button key={f} style={s.filterBtn(stateFilter === f)}
                onClick={() => { setStateFilter(f); setActiveViewId(null); }}>{f}</button>
            ))}
            <button style={s.refreshBtn} onClick={refresh}><RefreshCw size={14} /> Refresh</button>
            {isAdmin() && (
              <>
                <button style={s.refreshBtn} onClick={exportCSV} disabled={workflows.length === 0}>
                  <Download size={14} /> Export CSV
                </button>
                <button style={s.refreshBtn} onClick={() => importRef.current?.click()} disabled={importing}>
                  <Upload size={14} /> {importing ? "Importing..." : "Import CSV"}
                </button>
                <input ref={importRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleImport} />
              </>
            )}
          </div>

          <div style={{ ...s.panel, overflowX: "auto" }}>
            {loading ? (
              <div style={s.empty}>Loading workflows...</div>
            ) : filtered.length === 0 ? (
              <div style={s.empty}>No workflows found.</div>
            ) : (
              <table style={s.table}>
                <thead>
                  <tr>
                    {["Workflow", "Logic App", "Subscription", "Description", "SME", "Business Owner", "Team", "Criticality", "State", "Last Run", "Last Run Status", ...(isAdmin() ? [""] : [])].map(h => (
                      <th key={h} style={s.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(wf => {
                    const lr = lastRuns[wf.id];
                    const lastRunTime = lr?.lastRunTime;
                    const lastRunStatus = lr?.lastRunStatus;
                    const m = wf.metadata || {};
                    return (
                      <tr key={wf.id} style={s.tr}
                        onClick={() => navigate(`/workflow/${wf.subscriptionId}/${wf.resourceGroup}/${wf.siteName}/${wf.name}`)}
                        onMouseEnter={e => e.currentTarget.style.background = C.hover}
                        onMouseLeave={e => e.currentTarget.style.background = ""}
                      >
                        <td style={{ ...s.td, color: C.blue, fontWeight: 600, whiteSpace: "nowrap" }}>{wf.name}</td>
                        <td style={{ ...s.td, whiteSpace: "nowrap" }}>{wf.siteName}</td>
                        <td style={{ ...s.td, fontSize: 13, whiteSpace: "nowrap" }}>{wf.subscriptionName || wf.subscriptionId.slice(0, 8) + "..."}</td>
                        <td style={{ ...s.td, fontSize: 12, maxWidth: 220 }}>
                          {m.description
                            ? <span title={m.description} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.description}</span>
                            : <span style={{ color: "#444" }}>—</span>}
                        </td>
                        <td style={{ ...s.td, fontSize: 12, whiteSpace: "nowrap" }}>{m.sme_name || <span style={{ color: "#444" }}>—</span>}</td>
                        <td style={{ ...s.td, fontSize: 12, whiteSpace: "nowrap" }}>{m.business_owner_name || <span style={{ color: "#444" }}>—</span>}</td>
                        <td style={{ ...s.td, fontSize: 12, whiteSpace: "nowrap" }}>{m.team || <span style={{ color: "#444" }}>—</span>}</td>
                        <td style={s.td}><CriticalityBadge value={m.criticality} /></td>
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
                        {isAdmin() && (
                          <td style={s.td} onClick={e => e.stopPropagation()}>
                            {wf.state !== "Disabled" && (
                              <RunButton subId={wf.subscriptionId} rg={wf.resourceGroup} site={wf.siteName} name={wf.name} />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {activeTab === "function-apps" && (() => {
        const fnFiltered = (selectedSub.length
          ? functionApps.filter(a => selectedSub.includes(a.subscriptionId))
          : functionApps
        ).filter(a => {
          if (!fnSearch) return true;
          const q = fnSearch.toLowerCase();
          return a.name.toLowerCase().includes(q) ||
            a.resourceGroup.toLowerCase().includes(q) ||
            (a.runtimeStack || "").toLowerCase().includes(q);
        });
        const fnRunning = fnFiltered.filter(a => a.state === "Running").length;
        const fnLastOk = fnFiltered.filter(a => functionLastRuns[a.id]?.lastRunStatus === "Succeeded").length;
        const fnLastFailed = fnFiltered.filter(a => functionLastRuns[a.id]?.lastRunStatus === "Failed").length;
        return (
          <>
            <div style={s.grid}>
              <SummaryCard label="Total Apps"     value={fnFiltered.length} loading={fnLoading} accent={C.blue} />
              <SummaryCard label="Running"        value={fnRunning}         loading={fnLoading} accent={C.green} />
              <SummaryCard label="Last Run OK"    value={fnLastOk}          loading={fnLastRunsLoading} accent={C.gold} />
              <SummaryCard label="Last Run Failed" value={fnLastFailed}     loading={fnLastRunsLoading} accent={C.orange} />
            </div>
            {fnError && <div style={s.err}>{fnError}</div>}
            <div style={s.toolbar}>
              <MultiSelectDropdown
                options={subscriptions.map(s => ({ id: s.id, label: s.name }))}
                selected={selectedSub}
                onChange={handleSubChange}
                placeholder="All Subscriptions"
              />
              <div style={s.searchWrap}>
                <Search size={14} style={s.searchIcon} />
                <input style={s.input} placeholder="Search function apps..." value={fnSearch}
                  onChange={e => setFnSearch(e.target.value)} />
              </div>
              <button style={s.refreshBtn} onClick={loadFunctionApps}><RefreshCw size={14} /> Refresh</button>
            </div>
            <div style={{ ...s.panel, overflowX: "auto" }}>
              {fnLoading ? (
                <div style={s.empty}>Loading function apps...</div>
              ) : fnFiltered.length === 0 ? (
                <div style={s.empty}>No function apps found.</div>
              ) : (
                <table style={s.table}>
                  <thead>
                    <tr>
                      {["Function App", "Subscription", "Resource Group", "Runtime", "Location", "State", "Last Execution", "Last Status"].map(h => (
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fnFiltered.map(app => {
                      const lr = functionLastRuns[app.id];
                      const sub = subscriptions.find(s => s.id === app.subscriptionId);
                      return (
                        <FnAppRow
                          key={app.id}
                          app={app}
                          lr={lr}
                          subName={sub?.name || app.subscriptionId.slice(0, 8) + "..."}
                          fnLastRunsLoading={fnLastRunsLoading}
                        />
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        );
      })()}

      {(activeTab === "data-products" || activeTab === "ai-agents") && (
        <div style={{ ...s.panel, display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", color: C.textMute, fontSize: 16, fontStyle: "italic" }}>
          Coming soon...
        </div>
      )}
    </div>
  );
}

function ViewsDropdown({ views, currentUser, activeViewId, onApply, onSetDefault, onDelete, onSave, currentFilters }) {
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", visibility: "personal", isDefault: false });
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeView = views.find(v => v.id === activeViewId);
  const sharedViews = views.filter(v => v.visibility === "shared");
  const myViews = views.filter(v => v.visibility === "personal" && v.owner === currentUser?.username);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: form.name.trim(), filters: currentFilters, visibility: form.visibility, isDefault: form.isDefault });
      setForm({ name: "", visibility: "personal", isDefault: false });
      setShowForm(false);
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(v => !v)} style={{
        ...selectStyle, minWidth: 140, display: "flex", alignItems: "center", gap: 6,
        borderColor: activeViewId ? C.blue : C.border,
      }}>
        <Bookmark size={13} style={{ flexShrink: 0, color: activeViewId ? C.blue : C.textMute }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>
          {activeView ? activeView.name : "Views"}
        </span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200, width: 300,
          background: "#0a2e44", border: `1px solid ${C.border}`, borderRadius: 6,
          boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        }}>
          {sharedViews.length > 0 && (
            <div style={{ paddingTop: 6 }}>
              <div style={{ padding: "4px 14px", fontSize: 10, color: C.textMute, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                Shared Views
              </div>
              {sharedViews.map(v => (
                <ViewItem key={v.id} view={v} isActive={v.id === activeViewId} currentUser={currentUser}
                  onApply={() => { onApply(v); setOpen(false); }}
                  onSetDefault={() => onSetDefault(v.id)}
                  onDelete={() => onDelete(v.id)} />
              ))}
            </div>
          )}
          {myViews.length > 0 && (
            <div style={{ paddingTop: sharedViews.length ? 0 : 6 }}>
              <div style={{
                padding: "4px 14px", fontSize: 10, color: C.textMute, textTransform: "uppercase",
                letterSpacing: "0.08em", fontWeight: 600,
                ...(sharedViews.length ? { borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 4 } : {}),
              }}>
                My Views
              </div>
              {myViews.map(v => (
                <ViewItem key={v.id} view={v} isActive={v.id === activeViewId} currentUser={currentUser}
                  onApply={() => { onApply(v); setOpen(false); }}
                  onSetDefault={() => onSetDefault(v.id)}
                  onDelete={() => onDelete(v.id)} />
              ))}
            </div>
          )}
          {sharedViews.length === 0 && myViews.length === 0 && !showForm && (
            <div style={{ padding: "16px 14px", color: C.textMute, fontSize: 13, textAlign: "center" }}>
              No saved views yet
            </div>
          )}
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
            {!showForm ? (
              <button onClick={() => setShowForm(true)} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 14px",
                background: "none", border: "none", cursor: "pointer", color: C.blue, fontSize: 13, textAlign: "left",
              }}>
                <Bookmark size={13} /> Save current filters as view...
              </button>
            ) : (
              <div style={{ padding: "10px 12px" }}>
                <input
                  autoFocus
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setShowForm(false); }}
                  placeholder="View name..."
                  style={{ ...selectStyle, width: "100%", padding: "6px 10px", minWidth: 0, backgroundImage: "none", marginBottom: 8, boxSizing: "border-box" }}
                />
                {isAdmin() && (
                  <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 12, color: C.textSec }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                      <input type="radio" name="vis" value="personal" checked={form.visibility === "personal"}
                        onChange={() => setForm(f => ({ ...f, visibility: "personal" }))} style={{ accentColor: C.blue }} />
                      Personal
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                      <input type="radio" name="vis" value="shared" checked={form.visibility === "shared"}
                        onChange={() => setForm(f => ({ ...f, visibility: "shared" }))} style={{ accentColor: C.blue }} />
                      Shared (everyone)
                    </label>
                  </div>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textSec, marginBottom: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.isDefault}
                    onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} style={{ accentColor: C.blue }} />
                  Set as my default
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={handleSave} disabled={saving || !form.name.trim()} style={{
                    padding: "5px 14px", borderRadius: 5, border: "none", cursor: "pointer",
                    background: form.name.trim() ? C.blue : "#1a3a4a",
                    color: form.name.trim() ? "#0c2536" : C.textMute,
                    fontSize: 12, fontWeight: 600,
                  }}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button onClick={() => { setShowForm(false); setForm({ name: "", visibility: "personal", isDefault: false }); }} style={{
                    padding: "5px 14px", borderRadius: 5, border: `1px solid ${C.border}`, cursor: "pointer",
                    background: "none", color: C.textSec, fontSize: 12,
                  }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ViewItem({ view, isActive, currentUser, onApply, onSetDefault, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const isOwner = view.owner === currentUser?.username;
  const canDelete = isOwner || isAdmin();

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "flex", alignItems: "center", padding: "7px 14px", background: hovered ? C.hover : "none" }}
    >
      <span onClick={onApply} style={{
        flex: 1, fontSize: 13, color: isActive ? C.blue : C.textSec, fontWeight: isActive ? 600 : 400,
        cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {view.name}
      </span>
      {isOwner && (
        <button onClick={e => { e.stopPropagation(); onSetDefault(); }}
          title={view.isDefault ? "Remove default" : "Set as my default"}
          style={{ background: "none", border: "none", cursor: "pointer", padding: "0 5px",
            color: view.isDefault ? C.gold : C.textMute, fontSize: 15, lineHeight: 1, flexShrink: 0 }}>
          {view.isDefault ? "★" : "☆"}
        </button>
      )}
      {canDelete && (hovered || isActive) && (
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          title="Delete view"
          style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px",
            color: C.textMute, display: "flex", alignItems: "center", flexShrink: 0 }}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function MultiSelectDropdown({ options, selected, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = options.filter(o => (o.label || "").toLowerCase().includes(search.toLowerCase()));
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  const label = selected.length === 0 ? placeholder : `${selected.length} subscription${selected.length > 1 ? "s" : ""} selected`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(v => !v)} style={{
        ...selectStyle, minWidth: 200, display: "flex", alignItems: "center", justifyContent: "space-between",
        cursor: "pointer", userSelect: "none",
      }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100, minWidth: 260,
          background: "#0a2e44", border: `1px solid ${C.border}`, borderRadius: 6,
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.border}` }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search subscriptions..."
              style={{ ...selectStyle, width: "100%", padding: "6px 10px", minWidth: 0, backgroundImage: "none" }}
            />
          </div>
          {selected.length > 0 && (
            <div style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}` }}>
              <button onClick={() => onChange([])} style={{ background: "none", border: "none", color: C.blue, fontSize: 12, cursor: "pointer", padding: 0 }}>
                Clear all ({selected.length})
              </button>
            </div>
          )}
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {filtered.length === 0 && search
              ? <div style={{ padding: "12px 14px", color: C.textMute, fontSize: 13 }}>No matches</div>
              : filtered.map(o => (
                <label key={o.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                  cursor: "pointer", fontSize: 13, color: C.textSec,
                  background: selected.includes(o.id) ? C.hover : "none",
                }}>
                  <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)}
                    style={{ accentColor: C.blue, width: 14, height: 14, cursor: "pointer" }} />
                  {o.label}
                </label>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

function RunButton({ subId, rg, site, name }) {
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try { await api.run(subId, rg, site, name); }
    catch (e) { alert(`Run failed: ${e.message}`); }
    finally { setLoading(false); }
  };
  return (
    <button onClick={run} disabled={loading} style={{
      padding: "4px 12px", borderRadius: 4, border: "none",
      cursor: "pointer", background: "#7dc3cd", color: "#0c2536", fontSize: 12, fontWeight: 600,
      display: "flex", alignItems: "center", gap: 4,
    }}>
      <Play size={11} />{loading ? "..." : "Run"}
    </button>
  );
}

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
      display: "inline-block", fontSize: 11, fontWeight: 700, padding: "2px 8px",
      borderRadius: 999, letterSpacing: "0.04em", textTransform: "uppercase", ...st,
    }}>{value}</span>
  );
}

function FnAppRow({ app, lr, subName, fnLastRunsLoading }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const lastRunTime = lr?.lastRunTime;
  const lastRunStatus = lr?.lastRunStatus;
  const appInsightsConfigured = lr?.appInsightsConfigured;
  return (
    <tr style={{ ...s.tr, background: hovered ? C.hover : "" }}
      onClick={() => navigate(`/function-app/${app.subscriptionId}/${app.resourceGroup}/${app.name}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <td style={{ ...s.td, color: C.blue, fontWeight: 600, whiteSpace: "nowrap" }}>{app.name}</td>
      <td style={{ ...s.td, fontSize: 13, whiteSpace: "nowrap" }}>{subName}</td>
      <td style={{ ...s.td, fontSize: 13, whiteSpace: "nowrap" }}>{app.resourceGroup}</td>
      <td style={{ ...s.td, fontSize: 12, color: C.textMute }}>
        {app.runtimeStack ? app.runtimeStack.replace(/\|/g, " ").toLowerCase() : <span style={{ color: "#444" }}>—</span>}
      </td>
      <td style={{ ...s.td, fontSize: 12 }}>{app.location || "—"}</td>
      <td style={s.td}><StatusBadge status={app.state} /></td>
      <td style={{ ...s.td, fontSize: 12, color: C.textMute }}>
        {fnLastRunsLoading && !lr
          ? <span style={{ color: "#444" }}>...</span>
          : !appInsightsConfigured
            ? <span style={{ color: "#444" }} title="App Insights not configured">—</span>
            : lastRunTime
              ? <span title={format(new Date(lastRunTime), "PPpp")}>
                  {formatDistanceToNow(new Date(lastRunTime), { addSuffix: true })}
                </span>
              : <span style={{ color: "#444" }}>No runs</span>}
      </td>
      <td style={s.td}>
        {fnLastRunsLoading && !lr
          ? <span style={{ color: "#444" }}>...</span>
          : !appInsightsConfigured
            ? <span style={{ color: "#444" }} title="App Insights not configured">—</span>
            : lastRunStatus
              ? <StatusBadge status={lastRunStatus} />
              : <span style={{ color: "#444" }}>—</span>}
      </td>
    </tr>
  );
}

function SummaryCard({ label, value, loading, accent, onClick, active }) {
  const [hovered, setHovered] = useState(false);
  const clickable = !!onClick;
  return (
    <div
      style={{
        ...s.card,
        borderTop: `3px solid ${accent}`,
        ...(clickable && { cursor: "pointer", outline: active ? `2px solid ${accent}` : "none", outlineOffset: 2 }),
        ...(clickable && hovered && { background: C.hover }),
      }}
      onClick={onClick}
      onMouseEnter={() => clickable && setHovered(true)}
      onMouseLeave={() => clickable && setHovered(false)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={s.cardLabel}>{label}</div>
        {active && <span style={{ fontSize: 10, color: accent, border: `1px solid ${accent}`, borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>ACTIVE</span>}
      </div>
      <div style={{ ...s.cardValue, color: accent }}>{loading ? "..." : value}</div>
    </div>
  );
}
