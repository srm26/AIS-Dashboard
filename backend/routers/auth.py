from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from auth import authenticate, create_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(body: LoginRequest):
    user = authenticate(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["username"], user["role"])
    return {"token": token, "username": user["username"], "role": user["role"]}
