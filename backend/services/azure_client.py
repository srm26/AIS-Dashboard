import asyncio
import json
import httpx
import msal
from typing import Any, Dict, List, Optional
from config import settings

MGMT_BASE = "https://management.azure.com"
WEB_API_VERSION = "2022-03-01"   # Standard Logic Apps (Microsoft.Web/sites)
LOGIC_API_VERSION = "2016-06-01" # Consumption Logic Apps (Microsoft.Logic/workflows)
SCOPE = ["https://management.azure.com/.default"]

_MAX_RETRIES = 4
_RETRY_BASE_DELAY = 2.0  # seconds; doubles each attempt unless Retry-After is given


class AzureClient:
    def __init__(self, tenant_id: str, client_id: str, client_secret: str):
        self._app = msal.ConfidentialClientApplication(
            client_id,
            authority=f"https://login.microsoftonline.com/{tenant_id}",
            client_credential=client_secret,
        )
        # Shared client — reuses TCP connections across concurrent requests
        self._http = httpx.AsyncClient(
            timeout=30,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )

    def _get_token(self) -> str:
        result = self._app.acquire_token_silent(SCOPE, account=None)
        if not result:
            result = self._app.acquire_token_for_client(scopes=SCOPE)
        if "access_token" not in result:
            raise RuntimeError(f"Token acquisition failed: {result.get('error_description')}")
        return result["access_token"]

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self._get_token()}"}

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        """Execute an HTTP request with automatic retry on 429 (respects Retry-After)."""
        delay = _RETRY_BASE_DELAY
        for attempt in range(_MAX_RETRIES + 1):
            resp = await self._http.request(method, url, **kwargs)
            if resp.status_code != 429:
                resp.raise_for_status()
                return resp
            if attempt == _MAX_RETRIES:
                resp.raise_for_status()  # raise the 429 after exhausting retries
            retry_after = resp.headers.get("Retry-After")
            wait = float(retry_after) if retry_after else delay
            await asyncio.sleep(wait)
            delay *= 2  # exponential backoff if no Retry-After header

    async def get(self, path: str, params: Optional[Dict] = None, api_version: str = WEB_API_VERSION) -> Any:
        url = f"{MGMT_BASE}{path}"
        p = {"api-version": api_version}
        if params:
            p.update(params)
        resp = await self._request("GET", url, headers=self._headers(), params=p)
        return resp.json()

    async def post(self, path: str, json: Optional[Dict] = None, api_version: str = WEB_API_VERSION) -> Any:
        url = f"{MGMT_BASE}{path}"
        resp = await self._request(
            "POST", url,
            headers=self._headers(),
            params={"api-version": api_version},
            json=json or {},
        )
        return resp.json() if resp.content else {}

    async def paginate(self, path: str, params: Optional[Dict] = None, api_version: str = WEB_API_VERSION) -> List[Any]:
        results = []
        data = await self.get(path, params, api_version=api_version)
        results.extend(data.get("value", []))
        next_link = data.get("nextLink")
        while next_link:
            resp = await self._request("GET", next_link, headers=self._headers())
            page = resp.json()
            results.extend(page.get("value", []))
            next_link = page.get("nextLink")
        return results


# ---------------------------------------------------------------------------
# Client registry — global default + optional per-subscription overrides
# ---------------------------------------------------------------------------

# Global default: uses the top-level AZURE_* credentials in .env
_default_client = AzureClient(
    settings.azure_tenant_id,
    settings.azure_client_id,
    settings.azure_client_secret,
)

# Per-subscription overrides parsed from AZURE_SPNS (JSON array)
# Format: [{"subscription_id":"...","tenant_id":"...","client_id":"...","client_secret":"..."}]
_per_sub_clients: Dict[str, AzureClient] = {}

try:
    _spn_entries = json.loads(settings.azure_spns or "[]")
    for _entry in _spn_entries:
        _per_sub_clients[_entry["subscription_id"]] = AzureClient(
            _entry["tenant_id"],
            _entry["client_id"],
            _entry["client_secret"],
        )
except Exception as _e:
    import warnings
    warnings.warn(f"Failed to parse AZURE_SPNS: {_e}")


def get_client(subscription_id: str) -> AzureClient:
    """Return the SPN client for the given subscription, or the global default."""
    return _per_sub_clients.get(subscription_id, _default_client)
