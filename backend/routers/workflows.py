import asyncio
import time
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from datetime import datetime, timezone
from services.azure_client import get_client, WEB_API_VERSION
from config import settings
from auth import get_current_user, require_admin

_CACHE_TTL = 120  # seconds
_wf_cache: dict = {"data": None, "ts": 0.0}

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


def _parse_rg(resource_id: str) -> str:
    parts = resource_id.split("/")
    try:
        return parts[parts.index("resourceGroups") + 1]
    except (ValueError, IndexError):
        return ""


def _hostruntime(sub_id: str, rg: str, site: str, workflow: str = "") -> str:
    base = (
        f"/subscriptions/{sub_id}/resourceGroups/{rg}"
        f"/providers/Microsoft.Web/sites/{site}"
        f"/hostruntime/runtime/webhooks/workflow/api/management/workflows"
    )
    return f"{base}/{workflow}" if workflow else base


async def _list_sites_for_sub(sub_id: str) -> List[dict]:
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
    return [s for s in sites if "workflowapp" in (s.get("kind") or "").lower()]


async def _list_workflows_for_site(sub_id: str, rg: str, site_name: str) -> List[dict]:
    path = f"/subscriptions/{sub_id}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{site_name}/workflows"
    return await get_client(sub_id).paginate(path)


async def _get_all_workflow_specs(force: bool = False) -> List[dict]:
    """Enumerate all workflows across all subscriptions, cached for _CACHE_TTL seconds."""
    now = time.time()
    if not force and _wf_cache["data"] is not None and now - _wf_cache["ts"] < _CACHE_TTL:
        return _wf_cache["data"]

    async def _fetch_sites(sub_id: str):
        try:
            return sub_id, await _list_sites_for_sub(sub_id)
        except Exception:
            return sub_id, []

    site_lists = await asyncio.gather(*[_fetch_sites(s) for s in settings.subscription_ids])
    site_specs = [
        (sub_id, _parse_rg(site["id"]), site["name"])
        for sub_id, sites in site_lists
        for site in sites
    ]

    async def _fetch_workflows(sub_id: str, rg: str, site_name: str):
        try:
            return sub_id, rg, site_name, await _list_workflows_for_site(sub_id, rg, site_name)
        except Exception:
            return sub_id, rg, site_name, []

    wf_results = await asyncio.gather(*[_fetch_workflows(s, r, n) for s, r, n in site_specs])

    specs = []
    for sub_id, rg, site_name, workflows in wf_results:
        for wf in workflows:
            raw_name = wf["name"]
            wf_name = raw_name.split("/", 1)[-1] if "/" in raw_name else raw_name
            specs.append({
                "id": wf["id"],
                "wf": wf,
                "wf_name": wf_name,
                "site_name": site_name,
                "rg": rg,
                "sub_id": sub_id,
            })

    _wf_cache["data"] = specs
    _wf_cache["ts"] = now
    return specs


def _workflow_state(wf: dict) -> str:
    props = wf.get("properties", {})

    # 1. flowState is the Standard Logic Apps runtime enabled/disabled field
    flow_state = props.get("flowState", "")
    if flow_state:
        return flow_state.capitalize()

    # 2. properties.state — set by ARM-level disable/enable
    props_state = props.get("state", "")
    if props_state:
        return props_state.capitalize()

    # 3. Fall back to embedded workflow.json definition state
    files = props.get("files") or {}
    wf_json = files.get("workflow.json") or {}
    state = wf_json.get("state", "")
    if state:
        return state.capitalize()

    # 4. Fall back to health — only treat Healthy as Enabled; absent health ≠ Enabled
    health = (props.get("health") or {}).get("state", "")
    if health == "Healthy":
        return "Enabled"
    if health:
        return health
    return "Unknown"


async def _get_last_run(sub_id: str, rg: str, site_name: str, wf_name: str,
                        sem: asyncio.Semaphore) -> dict:
    async with sem:
        try:
            runs = await get_client(sub_id).paginate(
                f"{_hostruntime(sub_id, rg, site_name, wf_name)}/runs",
                params={"$top": "1"},
            )
            if runs:
                r = runs[0]
                props = r.get("properties") or {}
                return {
                    "lastRunTime": props.get("startTime") or r.get("startTime"),
                    "lastRunStatus": props.get("status") or r.get("status"),
                }
        except Exception:
            pass
        return {"lastRunTime": None, "lastRunStatus": None}


@router.get("/subscriptions")
async def list_subscriptions(_: dict = Depends(get_current_user)):
    subs = []
    for sub_id in settings.subscription_ids:
        try:
            data = await get_client(sub_id).get(f"/subscriptions/{sub_id}", api_version="2022-12-01")
            subs.append({"id": sub_id, "name": data.get("displayName", sub_id)})
        except Exception as e:
            # Surface permission errors so they're visible in the UI dropdown
            msg = "⚠ Access denied" if "403" in str(e) else "⚠ Unavailable"
            subs.append({"id": sub_id, "name": msg})
    return {"subscriptions": subs}


@router.get("")
async def list_workflows(_: dict = Depends(get_current_user)):
    sub_names: dict[str, str] = {}

    async def _fetch_sub_name(sub_id: str):
        try:
            data = await get_client(sub_id).get(f"/subscriptions/{sub_id}", api_version="2022-12-01")
            sub_names[sub_id] = data.get("displayName", sub_id)
        except Exception as e:
            sub_names[sub_id] = "⚠ Access denied" if "403" in str(e) else sub_id

    specs, _ = await asyncio.gather(
        _get_all_workflow_specs(),
        asyncio.gather(*[_fetch_sub_name(s) for s in settings.subscription_ids]),
    )

    workflows = [
        {
            "id": item["id"],
            "name": item["wf_name"],
            "siteName": item["site_name"],
            "resourceGroup": item["rg"],
            "subscriptionId": item["sub_id"],
            "subscriptionName": sub_names.get(item["sub_id"], item["sub_id"]),
            "location": item["wf"].get("location", ""),
            "state": _workflow_state(item["wf"]),
            "tags": item["wf"].get("tags", {}),
        }
        for item in specs
    ]
    return {"workflows": workflows, "errors": []}


@router.get("/last-runs")
async def get_last_runs(_: dict = Depends(get_current_user)):
    """Returns last-run info for every workflow, keyed by workflow resource ID."""
    specs = await _get_all_workflow_specs()
    sem = asyncio.Semaphore(8)
    last_runs = await asyncio.gather(*[
        _get_last_run(w["sub_id"], w["rg"], w["site_name"], w["wf_name"], sem)
        for w in specs
    ], return_exceptions=True)

    return {
        item["id"]: (lr if isinstance(lr, dict) else {"lastRunTime": None, "lastRunStatus": None})
        for item, lr in zip(specs, last_runs)
    }


@router.get("/summary")
async def get_summary(
    subscription_id: Optional[str] = None,
    site_name: Optional[str] = None,
    _: dict = Depends(get_current_user),
):
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    specs = await _get_all_workflow_specs()

    if subscription_id:
        specs = [s for s in specs if s["sub_id"] == subscription_id]
    if site_name:
        specs = [s for s in specs if s["site_name"] == site_name]

    total = len(specs)
    enabled = sum(1 for item in specs if _workflow_state(item["wf"]) != "Disabled")

    sem = asyncio.Semaphore(8)

    async def _fetch_today_runs(item: dict):
        async with sem:
            try:
                runs = await get_client(item["sub_id"]).paginate(
                    f"{_hostruntime(item['sub_id'], item['rg'], item['site_name'], item['wf_name'])}/runs",
                    params={"$filter": f"startTime ge {today_start.strftime('%Y-%m-%dT%H:%M:%SZ')}"},
                )
                failed = sum(
                    1 for r in runs
                    if (r.get("properties") or {}).get("status") == "Failed"
                    or r.get("status") == "Failed"
                )
                return item["id"], len(runs), failed
            except Exception:
                return item["id"], 0, 0

    run_results = await asyncio.gather(*[_fetch_today_runs(item) for item in specs])
    today_runs = sum(c for _, c, _ in run_results)
    today_failed = sum(f for _, _, f in run_results)
    failed_workflow_ids = [wf_id for wf_id, _, f in run_results if f > 0]

    return {"total": total, "enabled": enabled, "disabled": total - enabled,
            "runsToday": today_runs, "failedToday": today_failed,
            "failedWorkflowIds": failed_workflow_ids}


@router.get("/{subscription_id}/{resource_group}/{site_name}/{workflow_name}/runs")
async def list_runs(
    subscription_id: str, resource_group: str, site_name: str, workflow_name: str,
    top: int = Query(50, le=250),
    _: dict = Depends(get_current_user),
):
    path = f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}/runs"
    try:
        runs = await get_client(subscription_id).paginate(path, params={"$top": top})
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    result = []
    for run in runs:
        props = run.get("properties") or {}
        result.append({
            "id": run["id"],
            "name": run["name"],
            "status": props.get("status") or run.get("status"),
            "startTime": props.get("startTime") or run.get("startTime"),
            "endTime": props.get("endTime") or run.get("endTime"),
            "trigger": (props.get("trigger") or {}).get("name") or run.get("trigger"),
            "correlationId": (props.get("correlation") or {}).get("clientTrackingId") or run.get("correlationId"),
        })
    return {"runs": result}


@router.get("/{subscription_id}/{resource_group}/{site_name}/{workflow_name}/runs/{run_name}/actions")
async def list_run_actions(
    subscription_id: str, resource_group: str, site_name: str,
    workflow_name: str, run_name: str,
    _: dict = Depends(get_current_user),
):
    path = f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}/runs/{run_name}/actions"
    try:
        actions = await get_client(subscription_id).paginate(path)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    result = []
    for action in actions:
        props = action.get("properties") or {}
        result.append({
            "id": action["id"],
            "name": action["name"],
            "status": props.get("status") or action.get("status"),
            "startTime": props.get("startTime") or action.get("startTime"),
            "endTime": props.get("endTime") or action.get("endTime"),
            "code": props.get("code"),
            "error": props.get("error"),
            "inputsLink": (props.get("inputsLink") or {}).get("uri"),
            "outputsLink": (props.get("outputsLink") or {}).get("uri"),
        })
    return {"actions": result}


@router.get("/{subscription_id}/{resource_group}/{site_name}/{workflow_name}/runs/{run_name}/actions/{action_name}/payload")
async def get_action_payload(
    subscription_id: str, resource_group: str, site_name: str,
    workflow_name: str, run_name: str, action_name: str,
    _: dict = Depends(get_current_user),
):
    path = f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}/runs/{run_name}/actions/{action_name}"
    try:
        action = await get_client(subscription_id).get(path)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    props = action.get("properties") or {}
    inputs_link = (props.get("inputsLink") or {}).get("uri")
    outputs_link = (props.get("outputsLink") or {}).get("uri")
    inputs = outputs = None

    async with __import__("httpx").AsyncClient(timeout=30) as client:
        if inputs_link:
            try:
                r = await client.get(inputs_link)
                inputs = r.json() if r.content else None
            except Exception:
                inputs = {"error": "Could not fetch inputs"}
        if outputs_link:
            try:
                r = await client.get(outputs_link)
                outputs = r.json() if r.content else None
            except Exception:
                outputs = {"error": "Could not fetch outputs"}

    return {"inputs": inputs, "outputs": outputs}


@router.post("/{subscription_id}/{resource_group}/{site_name}/{workflow_name}/runs/{run_name}/resubmit")
async def resubmit_run(
    subscription_id: str, resource_group: str, site_name: str,
    workflow_name: str, run_name: str,
    _: dict = Depends(require_admin),
):
    client = get_client(subscription_id)
    run_path = f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}/runs/{run_name}"
    try:
        run = await client.get(run_path)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    props = run.get("properties") or {}
    trigger_name = (props.get("trigger") or {}).get("name") or run.get("trigger") or "manual"
    history_name = (props.get("correlation") or {}).get("clientTrackingId") or run.get("correlationId") or run_name

    path = (
        f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}"
        f"/triggers/{trigger_name}/histories/{history_name}/resubmit"
    )
    try:
        await client.post(path)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "resubmitted"}


@router.post("/{subscription_id}/{resource_group}/{site_name}/{workflow_name}/disable")
async def disable_workflow(
    subscription_id: str, resource_group: str, site_name: str, workflow_name: str,
    _: dict = Depends(require_admin),
):
    try:
        await get_client(subscription_id).post(f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}/disable")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    _wf_cache["data"] = None
    return {"status": "disabled"}


@router.post("/{subscription_id}/{resource_group}/{site_name}/{workflow_name}/enable")
async def enable_workflow(
    subscription_id: str, resource_group: str, site_name: str, workflow_name: str,
    _: dict = Depends(require_admin),
):
    try:
        await get_client(subscription_id).post(f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}/enable")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    _wf_cache["data"] = None
    return {"status": "enabled"}
