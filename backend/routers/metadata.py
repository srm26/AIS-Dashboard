import csv
import io
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
from auth import get_current_user, require_admin
from services.metadata import load_metadata, save_metadata

router = APIRouter(prefix="/api/metadata", tags=["metadata"])

_VALID_CRITICALITY = {"Low", "Medium", "High", "Critical", ""}
_META_FIELDS = ["description", "sme_name", "sme_email", "business_owner_name",
                "business_owner_email", "team", "criticality", "notes"]


class MetadataEntry(BaseModel):
    workflow_id: str
    description: Optional[str] = ""
    sme_name: Optional[str] = ""
    sme_email: Optional[str] = ""
    business_owner_name: Optional[str] = ""
    business_owner_email: Optional[str] = ""
    team: Optional[str] = ""
    criticality: Optional[str] = ""
    notes: Optional[str] = ""


@router.get("")
async def get_metadata(_: dict = Depends(get_current_user)):
    return {"metadata": load_metadata()}


@router.put("")
async def upsert_metadata(entry: MetadataEntry, _: dict = Depends(require_admin)):
    if entry.criticality and entry.criticality not in _VALID_CRITICALITY:
        raise HTTPException(status_code=400, detail="criticality must be one of: Low, Medium, High, Critical")
    store = load_metadata()
    store[entry.workflow_id] = {f: (getattr(entry, f) or "") for f in _META_FIELDS}
    save_metadata(store)
    return {"status": "ok"}


@router.post("/import")
async def import_metadata(file: UploadFile = File(...), _: dict = Depends(require_admin)):
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # handle Excel BOM
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded")

    reader = csv.DictReader(io.StringIO(text))
    if "workflow_id" not in (reader.fieldnames or []):
        raise HTTPException(status_code=400, detail="CSV must have a 'workflow_id' column")

    store = load_metadata()
    updated = 0
    for row in reader:
        wf_id = row.get("workflow_id", "").strip()
        if not wf_id:
            continue
        entry = store.get(wf_id, {})
        for field in _META_FIELDS:
            val = row.get(field, "").strip()
            if val:
                entry[field] = val
        if entry.get("criticality", "") not in _VALID_CRITICALITY:
            entry["criticality"] = ""
        store[wf_id] = entry
        updated += 1

    save_metadata(store)
    return {"status": "ok", "updated": updated}
