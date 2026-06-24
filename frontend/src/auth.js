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

/** On app init, pick up the sso_token query param written by /api/auth/azure-login. */
export function handleSSORedirect() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("sso_token");
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    window.history.replaceState({}, "", window.location.pathname);
  }
}

/** Kick off the Easy Auth Azure AD login flow. */
export function loginWithAzureAD() {
  window.location.href = "/.auth/login/aad?post_login_redirect_uri=/api/auth/azure-login";
}
