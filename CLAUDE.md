# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Azure Logic Apps Dashboard ("AIS Dashboard") — a full-stack web application for monitoring and managing Azure **Standard** Logic Apps (hosted as `Microsoft.Web/sites` with `kind: workflowapp`) across multiple Azure subscriptions.

## Commands

### Development (both servers)
```powershell
.\start.ps1
```
Opens two PowerShell windows: backend on `http://localhost:8000`, frontend dev server on `http://localhost:3000`.

### Backend only
```powershell
cd backend
.venv\Scripts\Activate.ps1
python main.py
```

### Frontend only
```powershell
cd frontend
npm run dev        # dev server with HMR at port 3000
npm run build      # production bundle → frontend/dist/
npm run preview    # preview the production build
```

### Production build (single-server mode)
```powershell
.\build-prod.ps1
# Then serve everything from the backend:
cd backend && .venv\Scripts\Activate.ps1 && python main.py
```
In production mode, FastAPI serves the React `dist/` bundle and all API routes share port 8000.

### Install / setup
```powershell
# Backend
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

There are no test suites or linters configured in this project.

## Architecture

### Backend (`backend/`)

**Entry point**: `main.py` — FastAPI app with CORS middleware. Mounts the React build at `/` in production (when `frontend/dist/` exists); in development, Vite proxies `/api` → `localhost:8000`.

**Config** (`config.py`): Pydantic `BaseSettings` that reads from `backend/.env` (not the project root).

Required env vars: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SUBSCRIPTION_IDS` (comma-separated).

Optional env vars:
- `AZURE_RESOURCE_GROUPS` — comma-separated filter; empty = all RGs
- `AZURE_SPNS` — JSON array of per-subscription SPN overrides: `[{"subscription_id":"...","tenant_id":"...","client_id":"...","client_secret":"..."}]`. Falls back to global `AZURE_*` creds when absent for a subscription.
- `AUTH_USERS` — comma-separated `username:password:role` entries; roles: `admin` or `viewer`
- `AUTH_SECRET_KEY` — secret for JWT signing (default: `change-me-to-a-random-secret`)
- `BACKEND_PORT`, `FRONTEND_ORIGIN`

**Auth** (`auth.py`, `routers/auth.py`): JWT-based login via `POST /api/auth/login`. Tokens are HS256-signed, expire after 8 hours, and carry `sub` (username) and `role` claims. Two FastAPI dependencies: `get_current_user` (any authenticated user) and `require_admin` (admin role only). All read endpoints use `get_current_user`; mutating endpoints (resubmit, enable, disable) use `require_admin`.

**Azure Client** (`services/azure_client.py`): Singleton factory `get_client(subscription_id)` returns the SPN client registered for that subscription, or the global default. Each `AzureClient` uses MSAL `ConfidentialClientApplication` for service-principal auth with silent token caching and a shared `httpx.AsyncClient` for connection reuse. Automatically retries on HTTP 429 with exponential backoff, respecting `Retry-After` headers (up to 4 retries).

Three async methods on `AzureClient`:
- `get(path, params, api_version)` — single GET against `https://management.azure.com`
- `post(path, json, api_version)` — single POST against `https://management.azure.com`
- `paginate(path, params, api_version)` — follows `nextLink` pagination against `https://management.azure.com`

Default `api_version` is `2022-03-01` (Standard Logic Apps via `Microsoft.Web`). Subscription-level calls use `api_version="2022-12-01"`. `LOGIC_API_VERSION = "2016-06-01"` is defined but unused — placeholder for future Consumption Logic Apps (`Microsoft.Logic/workflows`) support.

**Important exception — action payloads**: `inputsLink.uri` and `outputsLink.uri` from action responses are pre-signed Azure Storage URLs. The payload endpoint fetches these directly via `httpx` (not through `management.azure.com`).

**Router** (`routers/workflows.py`): All routes prefixed `/api/workflows`. The Azure ARM path pattern for Standard Logic App workflow operations uses the **hostruntime** pattern:
```
/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{site}
  /hostruntime/runtime/webhooks/workflow/api/management/workflows/{wf}/...
```

**Resubmit flow** is two steps: (1) fetch the run to extract `trigger.name` and `correlation.clientTrackingId`, then (2) POST to `/triggers/{trigger_name}/histories/{history_name}/resubmit`.

**Workflow state detection** (`_workflow_state`): three-level fallback — (1) `properties.files["workflow.json"].state`, (2) `properties.state` (set when workflow is disabled via API), (3) `properties.health.state` mapped to `Enabled`/health value. Returns `"Unknown"` only when all three are absent.

A concurrency semaphore (`asyncio.Semaphore(4)`) throttles parallel last-run fetches on the `/last-runs` and `/summary` endpoints.

### Frontend (`frontend/src/`)

React 18 + React Router v6 + Vite. **No CSS framework** — all styles are inline JS objects defined at the top of each component using a shared color constant `C`. No state management library; each component owns its local state.

**Auth** (`auth.js`): JWT stored in `localStorage` under `ais_auth_token`. `getUser()` decodes the payload client-side and checks expiry. `isAdmin()` returns true when `role === "admin"`. The API client (`api/client.js`) automatically redirects to `/login` on 401.

**Routing** (`App.jsx`): All routes except `/login` are wrapped in `ProtectedRoute` (redirects to `/login` if no valid token).
- `/` → `Dashboard` — summary cards + filterable workflow table
- `/workflow/:subId/:rg/:site/:name` → `WorkflowDetail` — run history list, enable/disable toggle
- `/workflow/:subId/:rg/:site/:name/run/:runName` → `RunDetail` — per-action accordion with inputs/outputs payloads

**Two-phase Dashboard load**: `Dashboard.jsx` fires `getWorkflows()` and `getSummary()` in parallel on mount, renders the table immediately when workflows arrive, then loads last-run data in the background via a separate `getLastRuns()` call. The table shows `...` placeholders until last-run data resolves.

**API layer** (`api/client.js`): Thin `fetch` wrapper. All calls go to `/api/*` (proxied to backend in dev via Vite config; served directly in production).

**Key components**:
- `Layout.jsx` — app shell with header, GES logo, breadcrumb navigation derived from URL path
- `StatusBadge.jsx` — shared colored badge for workflow states (`Enabled`/`Disabled`) and run statuses (`Succeeded`/`Failed`/`Running`/`Skipped`/`TimedOut`/`Cancelled`)

### Environment

The `.env` file lives at `backend/.env`. `start.ps1` auto-copies `.env.example` → `backend/.env` on first run if it doesn't exist.

Azure App Service deployments can inject a `PORT` env var; `main.py` respects it: `int(os.environ.get("PORT", settings.backend_port))`.
