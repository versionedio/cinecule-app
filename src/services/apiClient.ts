/**
 * Base API client for nostackai.
 * - Reads org config from .env (see .env.example)
 * - Keeps the x-nostackai-token in memory only (not localStorage)
 * - Attaches it as the `authorization` header (no "Bearer" prefix)
 * - Silently refreshes the token every 45 minutes and retries once on 401
 */

const ORG_API_ENDPOINT = import.meta.env.VITE_ORG_API_ENDPOINT as string;
const ORG_CODE = import.meta.env.VITE_ORG_CODE as string;
export const API_KEY = import.meta.env.VITE_API_KEY as string;
export const CLIENT_ID = import.meta.env.VITE_CLIENT_ID as string;

export const appBase = () => `${ORG_API_ENDPOINT}/app/${ORG_CODE}`;

let token: string | null = null;
let refreshTimer: number | undefined;

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function setToken(t: string | null) {
  token = t;
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (t) {
    refreshTimer = window.setInterval(refreshToken, 45 * 60 * 1000);
  }
}

export function getToken() {
  return token;
}

export async function refreshToken(): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(`${appBase()}/token?refresh`, {
      headers: { authorization: token }
    });
    const fresh = res.headers.get("x-nostackai-token");
    if (res.ok && fresh) {
      token = fresh;
      return true;
    }
  } catch {
    /* network error — keep old token, next call may still work */
  }
  return false;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryOn401 = true
): Promise<T> {
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined)
  };
  if (token && !headers["x-api-key"]) headers["authorization"] = token;
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${appBase()}${path}`, { ...options, headers });

  if (res.status === 401 && retryOn401 && token) {
    const ok = await refreshToken();
    if (ok) return request<T>(path, options, false);
  }

  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const msg =
      (body as { message?: string; error?: string } | undefined)?.message ||
      (body as { error?: string } | undefined)?.error ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string, headers?: Record<string, string>, signal?: AbortSignal) =>
    request<T>(path, { method: "GET", headers, signal }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined, headers }),
  put: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined, headers }),
  del: <T>(path: string, headers?: Record<string, string>) =>
    request<T>(path, { method: "DELETE", headers })
};

/** Raw fetch that also exposes response headers (needed by the two-step login). */
export async function rawFetch(path: string, options: RequestInit = {}) {
  return fetch(`${appBase()}${path}`, options);
}
