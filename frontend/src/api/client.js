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
  getRuns: (subId, rg, site, name, top = 50) =>
    req(`/workflows/${subId}/${rg}/${site}/${name}/runs?top=${top}`),
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
};
