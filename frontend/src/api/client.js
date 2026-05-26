const BASE = "/api";

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  getSubscriptions: () => req("/workflows/subscriptions"),
  getWorkflows: () => req("/workflows"),
  getSummary: () => req("/workflows/summary"),
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
};
