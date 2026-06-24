from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from auth import authenticate, create_token, resolve_azure_ad_user
from config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.get("/config")
def auth_config():
    return {"azure_ad_enabled": settings.azure_ad_enabled}


@router.post("/login")
async def login(body: LoginRequest):
    user = authenticate(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["username"], user["role"])
    return {"token": token, "username": user["username"], "role": user["role"]}


@router.get("/azure-login")
async def azure_login(request: Request):
    if not settings.azure_ad_enabled:
        raise HTTPException(status_code=400, detail="Azure AD SSO is not enabled")
    user = resolve_azure_ad_user(request)
    if not user:
        raise HTTPException(status_code=403, detail="Your account is not assigned to this application")
    token = create_token(user["username"], user["role"])
    return RedirectResponse(f"/?sso_token={token}", status_code=302)
