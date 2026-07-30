import json
import os
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user

router = APIRouter(prefix="/api/views", tags=["views"])

VIEWS_FILE = os.path.join(os.path.dirname(__file__), "..", "views.json")


def _load():
    if not os.path.exists(VIEWS_FILE):
        return []
    with open(VIEWS_FILE) as f:
        return json.load(f)


def _save(views):
    with open(VIEWS_FILE, "w") as f:
        json.dump(views, f, indent=2)


class ViewFilters(BaseModel):
    subscriptions: List[str] = []
    site: str = ""
    search: str = ""
    stateFilter: str = "All"


class CreateViewRequest(BaseModel):
    name: str
    filters: ViewFilters
    visibility: str = "personal"   # "personal" or "shared"
    isDefault: bool = False


@router.get("")
async def get_views(user: dict = Depends(get_current_user)):
    username = user["sub"]
    return [v for v in _load() if v["visibility"] == "shared" or v["owner"] == username]


@router.post("")
async def create_view(req: CreateViewRequest, user: dict = Depends(get_current_user)):
    username = user["sub"]
    if req.visibility == "shared" and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can create shared views")
    views = _load()
    if req.isDefault:
        for v in views:
            if v["owner"] == username:
                v["isDefault"] = False
    new_view = {
        "id": str(uuid.uuid4()),
        "name": req.name,
        "filters": req.filters.dict(),
        "owner": username,
        "visibility": req.visibility,
        "isDefault": req.isDefault,
    }
    views.append(new_view)
    _save(views)
    return new_view


@router.patch("/{view_id}/default")
async def toggle_default(view_id: str, user: dict = Depends(get_current_user)):
    username = user["sub"]
    views = _load()
    target = next((v for v in views if v["id"] == view_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="View not found")
    if target["owner"] != username:
        raise HTTPException(status_code=403, detail="Not allowed")
    # Toggle: if already default, remove it; otherwise set it (clearing previous)
    new_state = not target["isDefault"]
    for v in views:
        if v["owner"] == username:
            v["isDefault"] = False
    target["isDefault"] = new_state
    _save(views)
    return {"ok": True, "isDefault": new_state}


@router.delete("/{view_id}")
async def delete_view(view_id: str, user: dict = Depends(get_current_user)):
    username = user["sub"]
    views = _load()
    view = next((v for v in views if v["id"] == view_id), None)
    if not view:
        raise HTTPException(status_code=404, detail="View not found")
    if view["owner"] != username and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not allowed")
    _save([v for v in views if v["id"] != view_id])
    return {"ok": True}
