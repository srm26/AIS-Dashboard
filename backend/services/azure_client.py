import asyncio
import httpx
from typing import Any, Dict, List, Optional
from azure.identity import DefaultAzureCredential
from config import settings

MGMT_BASE = "https://management.azure.com"
WEB_API_VERSION = "2022-03-01"   # Standard Logic Apps (Microsoft.Web/sites)
LOGIC_API_VERSION = "2016-06-01" # Consumption Logic Apps (Microsoft.Logic/workflows)
SCOPE = "https://management.azure.com/.default"

_MAX_RETRIES = 4
_RETRY_BASE_DELAY = 2.0  # seconds; doubles each attempt unless Retry-After is given


class AzureClient:
    def __init__(self, client_id: Optional[str] = None):
        # client_id targets a specific user-assigned managed identity;
        # None uses system-assigned MI (or AzureCliCredential locally via DefaultAzureCredential)
        self._credential = DefaultAzureCredential(
            managed_identity_client_id=client_id or None,
            exclude_shared_token_cache_credential=True,
        )
        # Shared client — reuses TCP connections across concurrent requests
        self._http = httpx.AsyncClient(
            timeout=30,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )

    def _get_token(self) -> str:
        token = self._credential.get_token(SCOPE)
        return token.token

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
                resp.raise_for_status()
            retry_after = resp.headers.get("Retry-After")
            wait = float(retry_after) if retry_after else delay
            await asyncio.sleep(wait)
            delay *= 2

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


# Single global client — all subscriptions use the same managed identity.
# Set AZURE_MANAGED_IDENTITY_CLIENT_ID to target a specific user-assigned identity;
# leave unset for system-assigned.
_default_client = AzureClient(
    client_id=settings.azure_managed_identity_client_id or None,
)


def get_client(_subscription_id: str) -> AzureClient:
    """Return the Azure client for the given subscription."""
    return _default_client
