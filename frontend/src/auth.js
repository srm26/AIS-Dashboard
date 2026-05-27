const TOKEN_KEY = "ais_auth_token";

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** Decode the JWT payload and return {username, role}, or null if missing/expired. */
export function getUser() {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.exp * 1000 < Date.now()) {
      clearToken();
      return null;
    }
    return { username: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export function isAdmin() {
  return getUser()?.role === "admin";
}
