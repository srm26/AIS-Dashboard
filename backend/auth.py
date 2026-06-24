import base64
import hmac
import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from config import settings

_ALGORITHM = "HS256"
_TOKEN_EXPIRE_HOURS = 8

bearer = HTTPBearer()


def _parse_users() -> dict[str, tuple[str, str]]:
    """Return {username: (password, role)} from AUTH_USERS config."""
    users = {}
    for entry in settings.auth_users.split(","):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split(":")
        if len(parts) != 3:
            continue
        username, password, role = (p.strip() for p in parts)
        users[username] = (password, role.lower())
    return users


def authenticate(username: str, password: str) -> Optional[dict]:
    users = _parse_users()
    if username not in users:
        return None
    stored_password, role = users[username]
    # compare_digest prevents timing-based username enumeration
    if not hmac.compare_digest(stored_password, password):
        return None
    return {"username": username, "role": role}


def create_token(username: str, role: str) -> str:
    payload = {
        "sub": username,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=_TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, settings.auth_secret_key, algorithm=_ALGORITHM)


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, settings.auth_secret_key, algorithms=[_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    return _decode(creds.credentials)


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )
    return user


def resolve_azure_ad_user(request: Request) -> Optional[dict]:
    """
    Reads the X-MS-CLIENT-PRINCIPAL header injected by App Service Easy Auth.
    Returns {"username": ..., "role": "admin"|"viewer"} or None if not authorized.
    """
    header = request.headers.get("X-MS-CLIENT-PRINCIPAL")
    if not header:
        return None

    # Header is base64-encoded JSON; pad to a multiple of 4 for safe decoding
    padded = header + "=" * (-len(header) % 4)
    payload = json.loads(base64.b64decode(padded))
    claims = payload.get("claims", [])

    name = next(
        (c["val"] for c in claims if c["typ"] in ("preferred_username", "upn", "name")),
        "unknown",
    )
    groups = {c["val"] for c in claims if c["typ"] == "groups"}

    if settings.azure_ad_admin_group_id and settings.azure_ad_admin_group_id in groups:
        role = "admin"
    elif settings.azure_ad_viewer_group_id and settings.azure_ad_viewer_group_id in groups:
        role = "viewer"
    else:
        return None

    return {"username": name, "role": role}
