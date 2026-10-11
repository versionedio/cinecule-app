// Shared helpers for the render workflow scripts. Plain Node (>=20), no dependencies,
// so the cheap "is there work?" poll doesn't need `npm ci`.
import fs from "node:fs";

export const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
};

export const appBase = () => `${required("VITE_ORG_API_ENDPOINT")}/app/${required("VITE_ORG_CODE")}`;

/** Two-step login, same as the web app: /user/login -> oauthtoken, then /token -> x-nostackai-token. */
export async function login() {
  const step1 = await fetch(`${appBase()}/user/login`, {
    method: "POST",
    headers: { "x-api-key": required("VITE_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({ email: required("NS_EMAIL"), pwd: required("NS_PASSWORD") })
  });
  if (!step1.ok) throw new Error(`Login failed (${step1.status}): ${(await step1.text()).slice(0, 200)}`);
  let oauth = step1.headers.get("oauthtoken");
  if (!oauth) oauth = (await step1.json().catch(() => ({})))?.oauthtoken ?? null;
  if (!oauth) throw new Error("Login succeeded but returned no oauthtoken.");

  const step2 = await fetch(`${appBase()}/token`, { headers: { oauthtoken: oauth, client_id: required("VITE_CLIENT_ID") } });
  const token = step2.headers.get("x-nostackai-token");
  if (!step2.ok || !token) throw new Error(`Token exchange failed (${step2.status}).`);
  return token;
}

export function client(token) {
  const request = async (method, path, body) => {
    const res = await fetch(`${appBase()}${path}`, {
      method,
      headers: { authorization: token, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    if (!res.ok) {
      const msg = (json && (json.message || json.error)) || text || `HTTP ${res.status}`;
      throw new Error(`${method} ${path} -> ${res.status}: ${String(msg).slice(0, 300)}`);
    }
    return json;
  };
  return {
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b ?? {}),
    put: (p, b) => request("PUT", p, b),
    list: async (entity, params = {}) => {
      const qs = new URLSearchParams({ pagesize: "100", ...params }).toString();
      return (await request("GET", `/list/${entity}?${qs}`)).data ?? [];
    }
  };
}

export function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) fs.appendFileSync(file, `${name}=${value}\n`);
  else console.log(`[output] ${name}=${value}`);
}
