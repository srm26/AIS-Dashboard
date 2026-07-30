import asyncio
import time
import httpx
from typing import Dict, List, Optional
from azure.identity import DefaultAzureCredential
from config import settings

AI_BASE = "https://api.applicationinsights.io"
AI_SCOPE = "https://api.applicationinsights.io/.default"

_MAX_RETRIES = 4
_RETRY_BASE_DELAY = 2.0


class AppInsightsClient:
    def __init__(self, client_id: Optional[str] = None):
        self._credential = DefaultAzureCredential(
            managed_identity_client_id=client_id or None,
            exclude_shared_token_cache_credential=True,
        )
        self._token: Optional[str] = None
        self._token_expiry: float = 0.0
        self._http = httpx.AsyncClient(
            timeout=30,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )

    def _get_token(self) -> str:
        now = time.time()
        if self._token and self._token_expiry - now > 300:
            return self._token
        token = self._credential.get_token(AI_SCOPE)
        self._token = token.token
        self._token_expiry = token.expires_on
        return self._token

    async def _get_token_async(self) -> str:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._get_token)

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
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

    async def query(self, app_id: str, kql: str) -> List[Dict]:
        """Run a KQL query against the given Application Insights app ID."""
        url = f"{AI_BASE}/v1/apps/{app_id}/query"
        headers = {"Authorization": f"Bearer {await self._get_token_async()}"}
        resp = await self._request("POST", url, headers=headers, json={"query": kql})
        data = resp.json()
        tables = data.get("tables", [])
        if not tables:
            return []
        table = tables[0]
        columns = [c["name"] for c in table.get("columns", [])]
        return [dict(zip(columns, row)) for row in table.get("rows", [])]


_default_ai_client = AppInsightsClient(
    client_id=settings.azure_managed_identity_client_id or None,
)


def get_ai_client() -> AppInsightsClient:
    return _default_ai_client
