const API_BASE = import.meta.env.VITE_API_URL || "/api";
const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN || "";
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || "";
const COGNITO_USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || "";
const COGNITO_REGION =
  (COGNITO_USER_POOL_ID && COGNITO_USER_POOL_ID.split("_")[0]) || "us-east-1";
const COGNITO_REDIRECT_URI =
  import.meta.env.VITE_COGNITO_REDIRECT_URI ||
  `${window.location.origin}/auth/callback`;

const TOKEN_STORAGE_KEY = "booking_auth_id_token";
const PENDING_REG_STORAGE_KEY = "booking_pending_registration";

export function isCognitoConfigured() {
  return Boolean(COGNITO_CLIENT_ID && COGNITO_DOMAIN);
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
}

export function setStoredToken(token) {
  if (!token) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } else {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }
}

export function savePendingRegistration(data) {
  sessionStorage.setItem(PENDING_REG_STORAGE_KEY, JSON.stringify(data));
}

export function getPendingRegistration() {
  try {
    const raw = sessionStorage.getItem(PENDING_REG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPendingRegistration() {
  sessionStorage.removeItem(PENDING_REG_STORAGE_KEY);
}

// ============================================================================
// CLIENTE HTTP HACIA /api/* (CON INYECCIÓN DE JWT DE COGNITO)
// ============================================================================

export async function apiFetch(endpoint, options = {}) {
  const token = getStoredToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const detail = data.error || data.message || res.statusText || "Error desconocido";
    const err = new Error(`HTTP ${res.status}: ${detail}`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }

  return data;
}

// ============================================================================
// INTEGRACIÓN NATIVA CON AWS COGNITO (USER/PASSWORD + VERIFICACIÓN EMAIL + GOOGLE SSO)
// ============================================================================

async function cognitoIdpRequest(targetAction, payload) {
  const endpoint = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${targetAction}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      data.message || data.__type || "Error en autenticación con AWS Cognito."
    );
  }
  return data;
}

export async function cognitoSignUpWithEmail({
  email,
  password,
  firstName,
  lastName,
}) {
  if (!COGNITO_CLIENT_ID) {
    throw new Error("Cognito Client ID no configurado.");
  }
  return cognitoIdpRequest("SignUp", {
    ClientId: COGNITO_CLIENT_ID,
    Username: email.trim().toLowerCase(),
    Password: password,
    UserAttributes: [
      { Name: "email", Value: email.trim().toLowerCase() },
      { Name: "given_name", Value: firstName.trim() },
      { Name: "family_name", Value: lastName.trim() },
    ],
  });
}

export async function cognitoConfirmSignUp({ email, code }) {
  return cognitoIdpRequest("ConfirmSignUp", {
    ClientId: COGNITO_CLIENT_ID,
    Username: email.trim().toLowerCase(),
    ConfirmationCode: code.trim(),
  });
}

export async function cognitoSignInWithPassword({ email, password }) {
  const res = await cognitoIdpRequest("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: {
      USERNAME: email.trim().toLowerCase(),
      PASSWORD: password,
    },
  });
  const idToken = res?.AuthenticationResult?.IdToken;
  if (!idToken) {
    throw new Error("No se recibió IdToken desde AWS Cognito.");
  }
  setStoredToken(idToken);
  return idToken;
}

export function getGoogleSsoAuthorizeUrl(stateObj = {}) {
  const stateStr = btoa(JSON.stringify(stateObj));
  const params = new URLSearchParams({
    identity_provider: "Google",
    redirect_uri: COGNITO_REDIRECT_URI,
    response_type: "code",
    client_id: COGNITO_CLIENT_ID,
    scope: "email openid profile",
    state: stateStr,
  });
  return `https://${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCognitoCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: COGNITO_CLIENT_ID,
    code,
    redirect_uri: COGNITO_REDIRECT_URI,
  });

  const res = await fetch(`https://${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok || !data.id_token) {
    throw new Error(
      data.error_description ||
        data.error ||
        "Error intercambiando código OAuth en Cognito."
    );
  }
  setStoredToken(data.id_token);
  return data.id_token;
}

export async function localDevLogin({ email, first_name, last_name }) {
  const res = await apiFetch("/public/auth/local-login", {
    method: "POST",
    body: JSON.stringify({ email, first_name, last_name }),
  });
  setStoredToken(res.token);
  return res;
}

