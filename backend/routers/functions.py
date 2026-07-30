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


async def _read_app_settings(sub_id: str, site_path: str) -> dict:
    """Read app settings, retrying newer API versions first to handle subscription-specific 400s."""
    for version in ("2022-09-01", "2022-03-01", "2021-02-01"):
        try:
            data = await get_client(sub_id).post(
                f"{site_path}/config/appsettings/list",
                api_version=version,
            )
            return data.get("properties") or {}
        except Exception as e:
            if "400" not in str(e):
                return {}  # non-400 errors won't be fixed by a different version
    return {}


async def _find_app_id(sub_id: str, site_resource_id: str, instrumentation_key: str = "") -> Optional[str]:
    """Find App Insights AppId by IK match or hidden-link tag.

    Tries Resource Graph first (single cross-subscription call, works with basic Reader role),
    then falls back to direct per-subscription ARM enumeration.
    """
    site_id_lower = site_resource_id.lower()
    ik = instrumentation_key.strip() if instrumentation_key else ""

    # Resource Graph: one call covers all subscriptions, uses a different permission path
    # that works even when direct microsoft.insights/components ARM calls return 400.
    try:
        rows = await get_client(sub_id).resource_graph(
            "Resources"
            " | where type == 'microsoft.insights/components'"
            " | project appId=tostring(properties.AppId),"
            "   ik=tostring(properties.InstrumentationKey), tags",
            subscriptions=settings.subscription_ids,
        )
        for row in rows:
            if ik and row.get("ik", "").strip() == ik:
                return row.get("appId") or None
            tags = row.get("tags") or {}
            for tag_key in tags:
                if site_id_lower in tag_key.lower():
                    return row.get("appId") or None
    except Exception:
        pass

    # Fallback: direct ARM per-subscription paginate
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


def _get_ai_role_name(app_name: str) -> str:
    """Return the cloud_RoleName to use in KQL for this app.

    Falls back to the app's ARM resource name when no override is configured.
    Set AZURE_FUNCTION_ROLE_OVERRIDES={"fa-app-01":"actual-role-name"} when the
    function app emits telemetry under a different cloud_RoleName (e.g. a shared
    App Insights instance where WEBSITE_CLOUD_ROLENAME was customised).
    """
    return settings.function_role_overrides.get(app_name, app_name)


async def _get_ai_app_id(sub_id: str, rg: str, app_name: str) -> Optional[str]:
    """Return the Application Insights AppId for a Function App, cached for 1 hour."""
    cache_key = f"{sub_id}/{rg}/{app_name}"
    now = time.time()
    entry = _ai_config_cache.get(cache_key)
    if entry and now - entry["ts"] < _AI_CONFIG_TTL:
        return entry["app_id"]

    # Manual override takes precedence — used when auto-detection can't work
    override = settings.function_ai_overrides.get(app_name)
    if override:
        _ai_config_cache[cache_key] = {"app_id": override, "ts": now}
        return override

    site_resource_id = (
        f"/subscriptions/{sub_id}/resourceGroups/{rg}"
        f"/providers/Microsoft.Web/sites/{app_name}"
    )
    app_id = None
    ik = ""
    props = await _read_app_settings(sub_id, site_resource_id)
    conn_str = props.get("APPLICATIONINSIGHTS_CONNECTION_STRING", "")
    if conn_str:
        parsed = _parse_connection_string(conn_str)
        if parsed.get("ApplicationId"):
            app_id = parsed["ApplicationId"]
        elif parsed.get("InstrumentationKey"):
            ik = parsed["InstrumentationKey"]
    if not app_id and not ik:
        ik = props.get("APPINSIGHTS_INSTRUMENTATIONKEY", "")

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
    """Probe App Insights components with a test query to find which has telemetry
    for this function app. Uses Resource Graph first (works even when direct ARM
    calls return 400), then falls back to ARM per-subscription enumeration.
    """
    role_name = _get_ai_role_name(app_name)
    kql = (
        "requests"
        " | where timestamp > ago(30d)"
        f" | where cloud_RoleName =~ '{role_name}'"
        " | take 1"
        " | project timestamp"
    )
    candidates: List[str] = []

    # Resource Graph covers all subscriptions in one call, including those
    # where direct microsoft.insights/components ARM calls are blocked.
    try:
        rows = await get_client(sub_id).resource_graph(
            "Resources"
            " | where type == 'microsoft.insights/components'"
            " | project appId=tostring(properties.AppId)",
            subscriptions=settings.subscription_ids,
        )
        candidates = [r.get("appId") for r in rows if r.get("appId")]
    except Exception:
        pass

    # ARM per-subscription fallback for any gap in Resource Graph coverage
    subs = [sub_id] + [s for s in settings.subscription_ids if s != sub_id]
    for search_sub in subs:
        try:
            components = await get_client(search_sub).paginate(
                f"/subscriptions/{search_sub}/providers/microsoft.insights/components",
                api_version="2020-02-02",
            )
            for comp in components:
                app_id = (comp.get("properties") or {}).get("AppId")
                if app_id and app_id not in candidates:
                    candidates.append(app_id)
        except Exception:
            continue

    for comp_app_id in candidates:
        try:
            rows = await get_ai_client().query(comp_app_id, kql)
            if rows:
                return comp_app_id
        except Exception:
            continue
    return None


async def _get_logic_app_site_ids() -> set:
    """Return a set of ARM site resource IDs (lowercase) that host Logic Apps Standard workflows.

    Some older or non-standard Logic Apps Standard deployments don't include 'workflowapp'
    in their kind string, so kind-based filtering alone misses them. A Resource Graph query
    for child workflow resources is the reliable secondary check.
    """
    try:
        rows = await get_client(settings.subscription_ids[0]).resource_graph(
            "Resources"
            " | where type == 'microsoft.web/sites/workflows'"
            " | extend siteId = tolower(tostring(split(id, '/workflows/')[0]))"
            " | distinct siteId",
            subscriptions=settings.subscription_ids,
        )
        return {r.get("siteId", "") for r in rows if r.get("siteId")}
    except Exception:
        return set()


async def _list_function_apps_for_sub(sub_id: str, logic_app_site_ids: set) -> List[dict]:
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
        and s.get("id", "").lower() not in logic_app_site_ids
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

    # Fetch Logic Apps site IDs and subscription display names in parallel,
    # then fetch function app lists (needs la_ids for filtering).
    logic_app_site_ids, _ = await asyncio.gather(
        _get_logic_app_site_ids(),
        asyncio.gather(*[_fetch_sub_name(s) for s in settings.subscription_ids]),
    )

    async def _fetch(sub_id: str):
        try:
            return sub_id, await _list_function_apps_for_sub(sub_id, logic_app_site_ids)
        except Exception:
            return sub_id, []

    sub_results = await asyncio.gather(*[_fetch(s) for s in settings.subscription_ids])

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

        role_name = _get_ai_role_name(app["name"])
        kql = (
            "requests"
            " | where timestamp > ago(7d)"
            f" | where cloud_RoleName =~ '{role_name}'"
            " | order by timestamp desc"
            " | take 1"
            " | project timestamp, name, success, resultCode,"
            "   functionName=coalesce(tostring(customDimensions['faas.name']),"
            "     tostring(customDimensions['FunctionName']), name)"
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
    site_id_lower = site_resource_id.lower()
    out: dict = {
        "site_resource_id": site_resource_id,
        "app_settings_api_version_used": None,
        "app_settings_readable": False,
        "app_settings_error": None,
        "ai_settings_found": {},
        "ik": None,
        "resource_graph_total": None,
        "resource_graph_error": None,
        "resource_graph_ik_match": None,
        "resource_graph_hidden_link_match": None,
        "arm_subscriptions_searched": [],
        "ik_match": None,
        "hidden_link_match": None,
    }
    ik = ""

    # Try app settings with multiple API versions
    for version in ("2022-09-01", "2022-03-01", "2021-02-01"):
        try:
            data = await get_client(subscription_id).post(
                f"{site_resource_id}/config/appsettings/list",
                api_version=version,
            )
            props = data.get("properties") or {}
            out["app_settings_readable"] = True
            out["app_settings_api_version_used"] = version
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
            break
        except Exception as e:
            out["app_settings_error"] = f"{version}: {e}"
            if "400" not in str(e):
                break

    # Resource Graph discovery
    try:
        rows = await get_client(subscription_id).resource_graph(
            "Resources"
            " | where type == 'microsoft.insights/components'"
            " | project appId=tostring(properties.AppId),"
            "   ik=tostring(properties.InstrumentationKey), tags, name",
            subscriptions=settings.subscription_ids,
        )
        out["resource_graph_total"] = len(rows)
        for row in rows:
            if ik and row.get("ik", "").strip() == ik:
                out["resource_graph_ik_match"] = {"name": row.get("name"), "appId": row.get("appId")}
            tags = row.get("tags") or {}
            for tag_key in tags:
                if site_id_lower in tag_key.lower():
                    out["resource_graph_hidden_link_match"] = {"name": row.get("name"), "appId": row.get("appId"), "tag": tag_key}
    except Exception as e:
        out["resource_graph_error"] = str(e)

    # ARM per-subscription fallback
    subs = [subscription_id] + [s for s in settings.subscription_ids if s != subscription_id]
    for search_sub in subs:
        out["arm_subscriptions_searched"].append(search_sub)
        try:
            components = await get_client(search_sub).paginate(
                f"/subscriptions/{search_sub}/providers/microsoft.insights/components",
                api_version="2020-02-02",
            )
            out[f"arm_components_in_{search_sub[:8]}"] = len(components)
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
            out[f"arm_error_{search_sub[:8]}"] = str(e)

    # Discover distinct cloud_RoleNames in the resolved App Insights.
    # This helps diagnose cases where the function app emits telemetry under a
    # different name than its ARM resource name (e.g. shared App Insights with
    # WEBSITE_CLOUD_ROLENAME configured, or a Logic Apps Standard host).
    resolved_app_id = out.get("resource_graph_ik_match", {}).get("appId") \
        or out.get("ik_match", {}).get("app_id") \
        or (settings.function_ai_overrides.get(app_name))
    out["resolved_app_id"] = resolved_app_id
    out["role_name_override"] = settings.function_role_overrides.get(app_name)
    if resolved_app_id:
        try:
            role_rows = await get_ai_client().query(
                resolved_app_id,
                "requests | where timestamp > ago(30d)"
                " | summarize count() by cloud_RoleName"
                " | order by count_ desc | take 20",
            )
            out["cloud_role_names_30d"] = [
                {"roleName": r.get("cloud_RoleName"), "count": r.get("count_")}
                for r in role_rows
            ]
        except Exception as e:
            out["cloud_role_names_error"] = str(e)

    return out


@router.get("/{subscription_id}/{resource_group}/{app_name}/functions")
async def list_functions_in_app(
    subscription_id: str,
    resource_group: str,
    app_name: str = Path(..., pattern=r"^[a-zA-Z0-9_-]{1,60}$"),
    _: dict = Depends(get_current_user),
):
    """List individual functions within a Function App with 30-day stats."""
    app_id = await _get_ai_app_id(subscription_id, resource_group, app_name)
    if not app_id:
        raise HTTPException(status_code=404, detail=f"Application Insights not configured for '{app_name}'.")
    role_name = _get_ai_role_name(app_name)
    # Function name extraction: newer Functions hosts (OTLP/OpenTelemetry) use
    # customDimensions["faas.name"]; older hosts use "FunctionName"/"functionName";
    # operation_Name (= name field) is always set as a final fallback.
    kql = (
        "requests"
        " | where timestamp > ago(30d)"
        f" | where cloud_RoleName =~ '{role_name}'"
        " | extend fnName = case("
        "   isnotempty(tostring(customDimensions['faas.name'])), tostring(customDimensions['faas.name']),"
        "   isnotempty(tostring(customDimensions['FunctionName'])), tostring(customDimensions['FunctionName']),"
        "   isnotempty(tostring(customDimensions['functionName'])), tostring(customDimensions['functionName']),"
        "   name)"
        " | where isnotempty(fnName)"
        " | summarize lastRun=max(timestamp), totalRuns=count(),"
        "   successCount=countif(success==true) by fnName"
        " | extend successRate=round(todouble(successCount)/todouble(totalRuns)*100, 1)"
        " | order by lastRun desc"
    )
    try:
        rows = await get_ai_client().query(app_id, kql)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"functions": rows, "appId": app_id, "roleName": role_name}


@router.get("/{subscription_id}/{resource_group}/{app_name}/run/{operation_id}")
async def get_run_detail(
    subscription_id: str,
    resource_group: str,
    app_name: str = Path(..., pattern=r"^[a-zA-Z0-9_-]{1,60}$"),
    operation_id: str = Path(...),
    _: dict = Depends(get_current_user),
):
    """Return traces, exceptions, and dependencies for a single function invocation."""
    import re as _re
    if not _re.match(r'^[a-zA-Z0-9|._\-]{1,300}$', operation_id):
        raise HTTPException(status_code=400, detail="Invalid operation ID format.")
    app_id = await _get_ai_app_id(subscription_id, resource_group, app_name)
    if not app_id:
        raise HTTPException(status_code=404, detail=f"Application Insights not configured for '{app_name}'.")

    oid = operation_id.replace("'", "")  # belt-and-suspenders sanitise
    client = get_ai_client()
    req_kql = (
        f"requests | where operation_Id == '{oid}' | take 1"
        " | project timestamp, name, success, duration, resultCode, url, client_IP,"
        "   customDimensions, operation_Id"
    )
    traces_kql = (
        f"traces | where operation_Id == '{oid}' | order by timestamp asc"
        " | project timestamp, message, severityLevel, customDimensions"
    )
    exc_kql = (
        f"exceptions | where operation_Id == '{oid}'"
        " | project timestamp, type, outerMessage, innermostMessage, details"
    )
    deps_kql = (
        f"dependencies | where operation_Id == '{oid}' | order by timestamp asc"
        " | project timestamp, name, target, type, success, duration, resultCode, data"
    )
    results = await asyncio.gather(
        client.query(app_id, req_kql),
        client.query(app_id, traces_kql),
        client.query(app_id, exc_kql),
        client.query(app_id, deps_kql),
        return_exceptions=True,
    )

    def safe(r):
        return r if isinstance(r, list) else []

    req_rows, trace_rows, exc_rows, dep_rows = results
    return {
        "request": safe(req_rows)[0] if safe(req_rows) else None,
        "traces": safe(trace_rows),
        "exceptions": safe(exc_rows),
        "dependencies": safe(dep_rows),
    }


@router.get("/{subscription_id}/{resource_group}/{app_name}/runs")
async def list_fn_runs(
    subscription_id: str,
    resource_group: str,
    app_name: str = Path(..., pattern=r"^[a-zA-Z0-9_-]{1,60}$"),
    fn: str = Query(..., description="Function name to filter by"),
    days: int = Query(7, ge=1, le=30),
    top: int = Query(100, ge=1, le=500),
    _: dict = Depends(get_current_user),
):
    """List runs for a specific function within a Function App."""
    app_id = await _get_ai_app_id(subscription_id, resource_group, app_name)
    if not app_id:
        raise HTTPException(status_code=404, detail=f"Application Insights not configured for '{app_name}'.")
    role_name = _get_ai_role_name(app_name)
    fn_name = fn.replace("'", "")  # sanitise for KQL string literal
    kql = (
        "requests"
        f" | where cloud_RoleName =~ '{role_name}'"
        f" | where timestamp > ago({days}d)"
        # Match against faas.name (OTLP), FunctionName (classic), or operation_Name
        f" | where tostring(customDimensions['faas.name']) =~ '{fn_name}'"
        f"   or tostring(customDimensions['FunctionName']) =~ '{fn_name}'"
        f"   or tostring(customDimensions['functionName']) =~ '{fn_name}'"
        f"   or name =~ '{fn_name}'"
        " | order by timestamp desc"
        f" | take {top}"
        " | project timestamp, success, duration, resultCode, operation_Id, name,"
        "   triggerType=tostring(customDimensions['TriggerType']),"
        "   invocationId=coalesce(tostring(customDimensions['InvocationId']), tostring(customDimensions['faas.invocation_id'])),"
        "   url, client_IP"
    )
    try:
        rows = await get_ai_client().query(app_id, kql)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"runs": rows}


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
    role_name = _get_ai_role_name(app_name)
    kql = (
        "requests"
        f" | where timestamp > ago({days}d)"
        f" | where cloud_RoleName =~ '{role_name}'"
        " | order by timestamp desc"
        f" | take {top}"
        " | project timestamp, name, success, duration, resultCode, cloud_RoleName"
    )
    try:
        rows = await get_ai_client().query(app_id, kql)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"executions": rows, "appId": app_id}
