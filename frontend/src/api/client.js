import { getToken, clearToken } from "../auth";

const BASE = "/api";

async function req(path, options = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { headers, ...options });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

async function reqFormData(path, formData) {
  const token = getToken();
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: formData });
  if (res.status === 401) { clearToken(); window.location.href = "/login"; throw new Error("Session expired"); }
  if (!res.ok) { const text = await res.text(); throw new Error(text || `HTTP ${res.status}`); }
  return res.json();
}

export const api = {
  getSubscriptions: () => req("/workflows/subscriptions"),
  getWorkflows: () => req("/workflows"),
  getLastRuns: () => req("/workflows/last-runs"),
  getSummary: (subId = "", siteName = "") => {
    const p = new URLSearchParams();
    if (subId) p.set("subscription_id", subId);
    if (siteName) p.set("site_name", siteName);
    const qs = p.toString();
    return req(`/workflows/summary${qs ? `?${qs}` : ""}`);
  },
  getRuns: (subId, rg, site, name, startTime, endTime) => {
    const p = new URLSearchParams({ top: "250" });
    if (startTime) p.set("start_time", startTime);
    if (endTime) p.set("end_time", endTime);
    return req(`/workflows/${subId}/${rg}/${site}/${name}/runs?${p}`);
  },
  getActions: (subId, rg, site, name, runName) =>
    req(`/workflows/${subId}/${rg}/${site}/${name}/runs/${runName}/actions`),
  getPayload: (subId, rg, site, name, runName, actionName) =>
    req(`/workflows/${subId}/${rg}/${site}/${name}/runs/${runName}/actions/${actionName}/payload`),
  resubmit: (subId, rg, site, name, runName) =>
    req(`/workflows/${subId}/${rg}/${site}/${name}/runs/${runName}/resubmit`, { method: "POST" }),
  disable: (subId, rg, site, name) =>
    req(`/workflows/${subId}/${rg}/${site}/${name}/disable`, { method: "POST" }),
  enable: (subId, rg, site, name) =>
    req(`/workflows/${subId}/${rg}/${site}/${name}/enable`, { method: "POST" }),
  run: (subId, rg, site, name) =>
    req(`/workflows/${subId}/${rg}/${site}/${name}/run`, { method: "POST" }),
  getMetadata: () => req("/metadata"),
  updateWorkflowMetadata: (data) => req("/metadata", { method: "PUT", body: JSON.stringify(data) }),
  importMetadataCSV: (file) => { const fd = new FormData(); fd.append("file", file); return reqFormData("/metadata/import", fd); },
  getViews: () => req("/views"),
  createView: (data) => req("/views", { method: "POST", body: JSON.stringify(data) }),
  setDefaultView: (id) => req(`/views/${id}/default`, { method: "PATCH" }),
  deleteView: (id) => req(`/views/${id}`, { method: "DELETE" }),
  getFunctionApps: () => req("/functions"),
  getFunctionAppLastRuns: () => req("/functions/last-runs"),
  getFunctionAppExecutions: (subId, rg, appName, days = 7, top = 100) =>
    req(`/functions/${subId}/${rg}/${appName}/executions?days=${days}&top=${top}`),
  getFunctionsInApp: (subId, rg, appName) =>
    req(`/functions/${subId}/${rg}/${appName}/functions`),
  getFunctionRuns: (subId, rg, appName, fnName, days = 7, top = 100) =>
    req(`/functions/${subId}/${rg}/${appName}/runs?fn=${encodeURIComponent(fnName)}&days=${days}&top=${top}`),
  getFunctionRunDetail: (subId, rg, appName, operationId) =>
    req(`/functions/${subId}/${rg}/${appName}/run/${encodeURIComponent(operationId)}`),
};
