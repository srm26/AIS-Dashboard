import httpx
import msal
from typing import Any, Dict, List, Optional
from config import settings

MGMT_BASE = "https://management.azure.com"
WEB_API_VERSION = "2022-03-01"   # Standard Logic Apps (Microsoft.Web/sites)
LOGIC_API_VERSION = "2016-06-01" # Consumption Logic Apps (Microsoft.Logic/workflows)
SCOPE = ["https://management.azure.com/.default"]


class AzureClient:
    def __init__(self):
        self._app = msal.ConfidentialClientApplication(
            settings.azure_client_id,
            authority=f"https://login.microsoftonline.com/{settings.azure_tenant_id}",
            client_credential=settings.azure_client_secret,
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

    async def get(self, path: str, params: Optional[Dict] = None, api_version: str = WEB_API_VERSION) -> Any:
        url = f"{MGMT_BASE}{path}"
        p = {"api-version": api_version}
        if params:
            p.update(params)
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._headers(), params=p)
            resp.raise_for_status()
            return resp.json()

    async def post(self, path: str, json: Optional[Dict] = None, api_version: str = WEB_API_VERSION) -> Any:
        url = f"{MGMT_BASE}{path}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                url,
                headers=self._headers(),
                params={"api-version": api_version},
                json=json or {},
            )
            resp.raise_for_status()
            return resp.json() if resp.content else {}

    async def paginate(self, path: str, params: Optional[Dict] = None, api_version: str = WEB_API_VERSION) -> List[Any]:
        results = []
        data = await self.get(path, params, api_version=api_version)
        results.extend(data.get("value", []))
        next_link = data.get("nextLink")
        async with httpx.AsyncClient(timeout=30) as client:
            while next_link:
                resp = await client.get(next_link, headers=self._headers())
                resp.raise_for_status()
                page = resp.json()
                results.extend(page.get("value", []))
                next_link = page.get("nextLink")
        return results


azure = AzureClient()
