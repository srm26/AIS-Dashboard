import asyncio
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from auth import get_current_user, require_admin
from config import settings
from services.azure_client import get_client, WEB_API_VERSION
from services.app_insights_client import get_ai_client

_CACHE_TTL = 120         # seconds — function app list cache
_AI_CONFIG_TTL = 300     # seconds — App Insights app_id cache per function app (5 min)

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
    """Find App Insights AppId by IK match or hidden-link tag across all configured subscriptions.

    Searches the Function App's own subscription first, then others, to handle cases where
    the App Insights resource lives in a different subscription. Also matches by hidden-link
    tag for portal-connected App Insights that don't add app settings.
    """
    site_id_lower = site_resource_id.lower()
    ik = instrumentation_key.strip() if instrumentation_key else ""
    subs = [sub_id] + [s for s in settings.subscription_ids if s != sub_id]

    for search_sub in subs:
        try:
            components = await get_client(search_sub).paginate(
                f"/subscriptions/{search_sub}/providers/microsoft.insights/components",
                api_version="2020-02-02",
            )
            for comp in components:
                props = comp.get("properties") or {}
                if ik and props.get("InstrumentationKey", "").strip() == ik:
                    return props.get("AppId")
                tags = comp.get("tags") or {}
                for tag_key in tags:
                    if site_id_lower in tag_key.lower():
                        return props.get("AppId")
        except Exception:
            continue
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

    # Final fallback: probe App Insights components in the same resource group
    # by running a lightweight test query — works even when the SP cannot read
    # app settings and there is no hidden-link tag.
    if not app_id:
        app_id = await _find_app_id_by_sampling(sub_id, rg, app_name)

    _ai_config_cache[cache_key] = {"app_id": app_id, "ts": now}
    return app_id


async def _find_app_id_by_sampling(sub_id: str, rg: str, app_name: str) -> Optional[str]:
    """Probe App Insights components with a test query to find which one has telemetry
    for this function app. Searches subscription-wide (not just same RG) across all
    configured subscriptions. Used when app settings are unreadable and no hidden-link tag.
    """
    kql = (
        "requests"
        " | where timestamp > ago(30d)"
        f" | where cloud_RoleName =~ '{app_name}'"
        " | take 1"
        " | project timestamp"
    )
    subs = [sub_id] + [s for s in settings.subscription_ids if s != sub_id]
    for search_sub in subs:
        try:
            components = await get_client(search_sub).paginate(
                f"/subscriptions/{search_sub}/providers/microsoft.insights/components",
                api_version="2020-02-02",
            )
        except Exception:
            continue
        for comp in components:
            comp_app_id = (comp.get("properties") or {}).get("AppId")
            if not comp_app_id:
                continue
            try:
                rows = await get_ai_client().query(comp_app_id, kql)
                if rows:
                    return comp_app_id
            except Exception:
                continue
    return None


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


@router.get("/{subscription_id}/{resource_group}/{app_name}/ai-debug")
async def debug_ai_config(
    subscription_id: str,
    resource_group: str,
    app_name: str = Path(..., pattern=r"^[a-zA-Z0-9_-]{1,60}$"),
    _: dict = Depends(get_current_user),
):
    """Diagnose App Insights detection for a Function App (bypasses cache)."""
    site_resource_id = (
        f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}"
        f"/providers/Microsoft.Web/sites/{app_name}"
    )
    out: dict = {
        "site_resource_id": site_resource_id,
        "app_settings_readable": False,
        "app_settings_error": None,
        "ai_settings_found": {},
        "ik": None,
        "subscriptions_searched": [],
        "ik_match": None,
        "hidden_link_match": None,
    }
    ik = ""
    try:
        data = await get_client(subscription_id).post(
            f"{site_resource_id}/config/appsettings/list",
            api_version=WEB_API_VERSION,
        )
        props = data.get("properties") or {}
        out["app_settings_readable"] = True
        ai_keys = {k: v for k, v in props.items()
                   if any(kw in k.lower() for kw in ("insight", "instrumentation"))}
        out["ai_settings_found"] = ai_keys

        conn_str = props.get("APPLICATIONINSIGHTS_CONNECTION_STRING", "")
        if conn_str:
            parsed = _parse_connection_string(conn_str)
            ik = parsed.get("InstrumentationKey", "").strip()
            if parsed.get("ApplicationId"):
                out["conn_str_app_id"] = parsed["ApplicationId"]
        if not ik:
            ik = props.get("APPINSIGHTS_INSTRUMENTATIONKEY", "").strip()
        out["ik"] = ik[:8] + "..." if ik else None
    except Exception as e:
        out["app_settings_error"] = str(e)

    site_id_lower = site_resource_id.lower()
    subs = [subscription_id] + [s for s in settings.subscription_ids if s != subscription_id]
    for search_sub in subs:
        out["subscriptions_searched"].append(search_sub)
        try:
            components = await get_client(search_sub).paginate(
                f"/subscriptions/{search_sub}/providers/microsoft.insights/components",
                api_version="2020-02-02",
            )
            out[f"components_in_{search_sub[:8]}"] = len(components)
            for comp in components:
                props = comp.get("properties") or {}
                comp_ik = props.get("InstrumentationKey", "").strip()
                if ik and comp_ik == ik:
                    out["ik_match"] = {"name": comp.get("name"), "app_id": props.get("AppId"), "sub": search_sub[:8]}
                tags = comp.get("tags") or {}
                for tag_key in tags:
                    if site_id_lower in tag_key.lower():
                        out["hidden_link_match"] = {"name": comp.get("name"), "app_id": props.get("AppId"), "tag": tag_key}
        except Exception as e:
            out[f"components_error_{search_sub[:8]}"] = str(e)

    return out


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
