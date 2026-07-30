import asyncio
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from auth import get_current_user
from config import settings
from services.azure_client import get_client, WEB_API_VERSION
from services.app_insights_client import get_ai_client

_CACHE_TTL = 120         # seconds — function app list cache
_AI_CONFIG_TTL = 3600    # seconds — App Insights app_id cache per function app

_fn_cache: dict = {"data": None, "ts": 0.0}
_ai_config_cache: dict = {}  # key: "{sub}/{rg}/{app}" → {"app_id": str|None, "ts": float}

router = APIRouter(prefix="/api/functions", tags=["functions"])


def _parse_rg(resource_id: str) -> str:
    parts = resource_id.split("/")
    try:
        return parts[parts.index("resourceGroups") + 1]
    except (ValueError, IndexError):
        return ""


def _parse_connection_string(conn_str: str) -> dict:
    """Parse an Application Insights connection string into a dict of key→value pairs."""
    result = {}
    for segment in conn_str.split(";"):
        if "=" in segment:
            k, v = segment.split("=", 1)
            result[k.strip()] = v.strip()
    return result


async def _find_app_id(sub_id: str, site_resource_id: str, instrumentation_key: str = "") -> Optional[str]:
    """Find App Insights AppId by IK match or hidden-link tag on App Insights components.

    When App Insights is connected via the Azure portal (not via app settings), Azure stamps a
    'hidden-link:' tag on the App Insights component pointing at the Function App resource ID.
    This covers that case as a final fallback.
    """
    try:
        components = await get_client(sub_id).paginate(
            f"/subscriptions/{sub_id}/providers/microsoft.insights/components",
            api_version="2020-02-02",
        )
        site_id_lower = site_resource_id.lower()
        for comp in components:
            props = comp.get("properties") or {}
            if instrumentation_key and props.get("InstrumentationKey") == instrumentation_key:
                return props.get("AppId")
            tags = comp.get("tags") or {}
            for tag_key in tags:
                if site_id_lower in tag_key.lower():
                    return props.get("AppId")
    except Exception:
        pass
    return None


async def _get_ai_app_id(sub_id: str, rg: str, app_name: str) -> Optional[str]:
    """Return the Application Insights AppId for a Function App, cached for 1 hour."""
    cache_key = f"{sub_id}/{rg}/{app_name}"
    now = time.time()
    entry = _ai_config_cache.get(cache_key)
    if entry and now - entry["ts"] < _AI_CONFIG_TTL:
        return entry["app_id"]

    site_resource_id = (
        f"/subscriptions/{sub_id}/resourceGroups/{rg}"
        f"/providers/Microsoft.Web/sites/{app_name}"
    )
    app_id = None
    ik = ""
    try:
        data = await get_client(sub_id).post(
            f"{site_resource_id}/config/appsettings/list",
            api_version=WEB_API_VERSION,
        )
        props = data.get("properties") or {}

        # Prefer modern connection string (may contain ApplicationId directly)
        conn_str = props.get("APPLICATIONINSIGHTS_CONNECTION_STRING", "")
        if conn_str:
            parsed = _parse_connection_string(conn_str)
            if parsed.get("ApplicationId"):
                app_id = parsed["ApplicationId"]
            elif parsed.get("InstrumentationKey"):
                ik = parsed["InstrumentationKey"]

        # Fall back to legacy instrumentation key app setting
        if not app_id and not ik:
            ik = props.get("APPINSIGHTS_INSTRUMENTATIONKEY", "")
    except Exception:
        pass

    # Look up by IK or by hidden-link tag (portal-connected App Insights)
    if not app_id:
        app_id = await _find_app_id(sub_id, site_resource_id, ik)

    _ai_config_cache[cache_key] = {"app_id": app_id, "ts": now}
    return app_id


async def _list_function_apps_for_sub(sub_id: str) -> List[dict]:
    client = get_client(sub_id)
    rg_filter = settings.resource_group_filter
    if rg_filter:
        results = await asyncio.gather(*[
            client.paginate(f"/subscriptions/{sub_id}/resourceGroups/{rg}/providers/Microsoft.Web/sites")
            for rg in rg_filter
        ])
        sites = [s for items in results for s in items]
    else:
        sites = await client.paginate(f"/subscriptions/{sub_id}/providers/Microsoft.Web/sites")
    return [
        s for s in sites
        if "functionapp" in (s.get("kind") or "").lower()
        and "workflowapp" not in (s.get("kind") or "").lower()
    ]


async def _get_all_function_apps(force: bool = False) -> List[dict]:
    now = time.time()
    if not force and _fn_cache["data"] is not None and now - _fn_cache["ts"] < _CACHE_TTL:
        return _fn_cache["data"]

    sub_names: dict = {}

    async def _fetch_sub_name(sub_id: str):
        try:
            data = await get_client(sub_id).get(f"/subscriptions/{sub_id}", api_version="2022-12-01")
            sub_names[sub_id] = data.get("displayName", sub_id)
        except Exception:
            sub_names[sub_id] = sub_id

    async def _fetch(sub_id: str):
        try:
            return sub_id, await _list_function_apps_for_sub(sub_id)
        except Exception:
            return sub_id, []

    sub_results, _ = await asyncio.gather(
        asyncio.gather(*[_fetch(s) for s in settings.subscription_ids]),
        asyncio.gather(*[_fetch_sub_name(s) for s in settings.subscription_ids]),
    )

    apps = []
    for sub_id, site_list in sub_results:
        for site in site_list:
            props = site.get("properties") or {}
            site_config = props.get("siteConfig") or {}
            runtime_stack = (
                site_config.get("linuxFxVersion")
                or site_config.get("windowsFxVersion")
                or ""
            )
            apps.append({
                "id": site["id"],
                "name": site["name"],
                "resourceGroup": _parse_rg(site["id"]),
                "subscriptionId": sub_id,
                "subscriptionName": sub_names.get(sub_id, sub_id),
                "location": site.get("location", ""),
                "state": props.get("state", "Unknown"),
                "kind": site.get("kind", ""),
                "runtimeStack": runtime_stack,
            })

    _fn_cache["data"] = apps
    _fn_cache["ts"] = now
    return apps


async def _get_fn_last_run(app: dict, sem: asyncio.Semaphore) -> dict:
    async with sem:
        try:
            app_id = await _get_ai_app_id(app["subscriptionId"], app["resourceGroup"], app["name"])
        except Exception:
            return {"lastRunTime": None, "lastRunStatus": None, "appInsightsConfigured": False}

        if not app_id:
            return {"lastRunTime": None, "lastRunStatus": None, "appInsightsConfigured": False}

        kql = (
            "requests"
            " | where timestamp > ago(7d)"
            f" | where cloud_RoleName =~ '{app['name']}'"
            " | order by timestamp desc"
            " | take 1"
            " | project timestamp, name, success, resultCode"
        )
        try:
            rows = await get_ai_client().query(app_id, kql)
        except Exception:
            return {"lastRunTime": None, "lastRunStatus": None, "appInsightsConfigured": True}

        if not rows:
            return {"lastRunTime": None, "lastRunStatus": None, "appInsightsConfigured": True}

        r = rows[0]
        return {
            "lastRunTime": r.get("timestamp"),
            "lastRunStatus": "Succeeded" if r.get("success") else "Failed",
            "functionName": r.get("name"),
            "appInsightsConfigured": True,
        }


@router.get("")
async def list_function_apps(_: dict = Depends(get_current_user)):
    apps = await _get_all_function_apps()
    return {"functions": apps}


# Must be declared before /{subscription_id}/... to avoid FastAPI routing ambiguity
@router.get("/last-runs")
async def get_last_runs(_: dict = Depends(get_current_user)):
    apps = await _get_all_function_apps()
    sem = asyncio.Semaphore(4)
    results = await asyncio.gather(
        *[_get_fn_last_run(app, sem) for app in apps],
        return_exceptions=True,
    )
    return {
        app["id"]: (
            r if isinstance(r, dict)
            else {"lastRunTime": None, "lastRunStatus": None, "appInsightsConfigured": False}
        )
        for app, r in zip(apps, results)
    }


@router.get("/{subscription_id}/{resource_group}/{app_name}/executions")
async def list_executions(
    subscription_id: str,
    resource_group: str,
    app_name: str = Path(..., pattern=r"^[a-zA-Z0-9_-]{1,60}$"),
    days: int = Query(7, ge=1, le=30),
    top: int = Query(100, ge=1, le=500),
    _: dict = Depends(get_current_user),
):
    app_id = await _get_ai_app_id(subscription_id, resource_group, app_name)
    if not app_id:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Application Insights is not configured for '{app_name}', "
                "or APPLICATIONINSIGHTS_CONNECTION_STRING is missing from its app settings."
            ),
        )
    kql = (
        "requests"
        f" | where timestamp > ago({days}d)"
        f" | where cloud_RoleName =~ '{app_name}'"
        " | order by timestamp desc"
        f" | take {top}"
        " | project timestamp, name, success, duration, resultCode, cloud_RoleName"
    )
    try:
        rows = await get_ai_client().query(app_id, kql)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"executions": rows, "appId": app_id}
