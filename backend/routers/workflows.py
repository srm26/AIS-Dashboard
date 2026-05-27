import asyncio
from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from datetime import datetime, timezone
from services.azure_client import azure, WEB_API_VERSION
from config import settings

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
    rg_filter = settings.resource_group_filter
    if rg_filter:
        sites = []
        for rg in rg_filter:
            path = f"/subscriptions/{sub_id}/resourceGroups/{rg}/providers/Microsoft.Web/sites"
            items = await azure.paginate(path)
            sites.extend(items)
    else:
        path = f"/subscriptions/{sub_id}/providers/Microsoft.Web/sites"
        sites = await azure.paginate(path)
    return [s for s in sites if "workflowapp" in (s.get("kind") or "").lower()]


async def _list_workflows_for_site(sub_id: str, rg: str, site_name: str) -> List[dict]:
    path = f"/subscriptions/{sub_id}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{site_name}/workflows"
    return await azure.paginate(path)


def _workflow_state(wf: dict) -> str:
    props = wf.get("properties", {})

    # 1. Check embedded workflow.json definition state
    files = props.get("files") or {}
    wf_json = files.get("workflow.json") or {}
    state = wf_json.get("state", "")
    if state:
        return state.capitalize()

    # 2. Check top-level properties.state (set when workflow is disabled via API)
    props_state = props.get("state", "")
    if props_state:
        return props_state.capitalize()

    # 3. Fall back to health — only treat Healthy as Enabled; absent health ≠ Enabled
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
            runs = await azure.paginate(
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
async def list_subscriptions():
    subs = []
    for sub_id in settings.subscription_ids:
        try:
            data = await azure.get(f"/subscriptions/{sub_id}", api_version="2022-12-01")
            subs.append({"id": sub_id, "name": data.get("displayName", sub_id)})
        except Exception:
            subs.append({"id": sub_id, "name": sub_id})
    return {"subscriptions": subs}


@router.get("")
async def list_workflows():
    all_workflows = []
    errors = []
    sub_names: dict[str, str] = {}

    # Fetch subscription display names in parallel
    async def _fetch_sub_name(sub_id: str):
        try:
            data = await azure.get(f"/subscriptions/{sub_id}", api_version="2022-12-01")
            sub_names[sub_id] = data.get("displayName", sub_id)
        except Exception:
            sub_names[sub_id] = sub_id

    await asyncio.gather(*[_fetch_sub_name(s) for s in settings.subscription_ids])

    # Build raw workflow list
    raw_workflows = []
    for sub_id in settings.subscription_ids:
        try:
            sites = await _list_sites_for_sub(sub_id)
        except Exception as e:
            errors.append({"subscriptionId": sub_id, "error": str(e)})
            continue

        for site in sites:
            rg = _parse_rg(site["id"])
            site_name = site["name"]
            try:
                workflows = await _list_workflows_for_site(sub_id, rg, site_name)
            except Exception as e:
                errors.append({"site": site_name, "error": str(e)})
                continue

            for wf in workflows:
                raw_name = wf["name"]
                wf_name = raw_name.split("/", 1)[-1] if "/" in raw_name else raw_name
                raw_workflows.append({
                    "wf": wf,
                    "wf_name": wf_name,
                    "site_name": site_name,
                    "rg": rg,
                    "sub_id": sub_id,
                })

    # Fetch last run for all workflows in parallel (semaphore created here, inside the event loop)
    sem = asyncio.Semaphore(8)
    last_runs = await asyncio.gather(*[
        _get_last_run(w["sub_id"], w["rg"], w["site_name"], w["wf_name"], sem)
        for w in raw_workflows
    ], return_exceptions=True)

    for item, last_run in zip(raw_workflows, last_runs):
        if not isinstance(last_run, dict):
            last_run = {"lastRunTime": None, "lastRunStatus": None}
        sub_id = item["sub_id"]
        all_workflows.append({
            "id": item["wf"]["id"],
            "name": item["wf_name"],
            "siteName": item["site_name"],
            "resourceGroup": item["rg"],
            "subscriptionId": sub_id,
            "subscriptionName": sub_names.get(sub_id, sub_id),
            "location": item["wf"].get("location", ""),
            "state": _workflow_state(item["wf"]),
            "lastRunTime": last_run["lastRunTime"],
            "lastRunStatus": last_run["lastRunStatus"],
            "tags": item["wf"].get("tags", {}),
        })

    return {"workflows": all_workflows, "errors": errors}


@router.get("/summary")
async def get_summary():
    total = enabled = disabled = 0
    today_runs = 0
    today_failed = 0
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    for sub_id in settings.subscription_ids:
        try:
            sites = await _list_sites_for_sub(sub_id)
        except Exception:
            continue

        for site in sites:
            rg = _parse_rg(site["id"])
            site_name = site["name"]
            try:
                workflows = await _list_workflows_for_site(sub_id, rg, site_name)
            except Exception:
                continue

            for wf in workflows:
                total += 1
                state = _workflow_state(wf)
                if state == "Disabled":
                    disabled += 1
                else:
                    enabled += 1
                raw_name = wf["name"]
                wf_name = raw_name.split("/", 1)[-1] if "/" in raw_name else raw_name
                try:
                    runs = await azure.paginate(
                        f"{_hostruntime(sub_id, rg, site_name, wf_name)}/runs",
                        params={"$filter": f"startTime ge {today_start.strftime('%Y-%m-%dT%H:%M:%SZ')}"},
                    )
                    today_runs += len(runs)
                    today_failed += sum(
                        1 for r in runs
                        if (r.get("properties") or {}).get("status") == "Failed"
                        or r.get("status") == "Failed"
                    )
                except Exception:
                    pass

    return {"total": total, "enabled": enabled, "disabled": disabled,
            "runsToday": today_runs, "failedToday": today_failed}


@router.get("/{subscription_id}/{resource_group}/{site_name}/{workflow_name}/runs")
async def list_runs(
    subscription_id: str, resource_group: str, site_name: str, workflow_name: str,
    top: int = Query(50, le=250),
):
    path = f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}/runs"
    try:
        runs = await azure.paginate(path, params={"$top": top})
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
):
    path = f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}/runs/{run_name}/actions"
    try:
        actions = await azure.paginate(path)
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
):
    path = f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}/runs/{run_name}/actions/{action_name}"
    try:
        action = await azure.get(path)
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
):
    run_path = f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}/runs/{run_name}"
    try:
        run = await azure.get(run_path)
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
        await azure.post(path)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "resubmitted"}


@router.post("/{subscription_id}/{resource_group}/{site_name}/{workflow_name}/disable")
async def disable_workflow(subscription_id: str, resource_group: str, site_name: str, workflow_name: str):
    try:
        await azure.post(f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}/disable")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "disabled"}


@router.post("/{subscription_id}/{resource_group}/{site_name}/{workflow_name}/enable")
async def enable_workflow(subscription_id: str, resource_group: str, site_name: str, workflow_name: str):
    try:
        await azure.post(f"{_hostruntime(subscription_id, resource_group, site_name, workflow_name)}/enable")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "enabled"}
