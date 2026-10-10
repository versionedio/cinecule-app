import { API_KEY, CLIENT_ID, ApiError, api, rawFetch, setToken } from "./apiClient";

export interface Profile {
  fn?: string;
  ln?: string;
  email?: string;
  email_verified?: boolean;
  org_name?: string;
  org_code?: string;
  picurl?: string;
  picture?: string;
}

/**
 * Two-step login:
 *  1. POST /user/login (x-api-key)  -> oauthtoken response header
 *  2. GET  /token (oauthtoken + client_id) -> x-nostackai-token header + profile body
 */
export async function login(email: string, pwd: string): Promise<Profile> {
  const step1 = await rawFetch(`/user/login`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, pwd })
  });
  if (!step1.ok) {
    const text = await step1.text();
    throw new ApiError(step1.status, text || "Login failed — check email and password.");
  }
  // The oauthtoken arrives as a response header; some setups also echo it in the body.
  let oauthtoken = step1.headers.get("oauthtoken");
  if (!oauthtoken) {
    try {
      const body = await step1.json();
      oauthtoken = body?.oauthtoken ?? null;
    } catch {
      /* no body */
    }
  }
  if (!oauthtoken) {
    throw new ApiError(
      500,
      "Login succeeded but no oauthtoken header was readable. The org may need to expose it via CORS (Access-Control-Expose-Headers)."
    );
  }

  const step2 = await rawFetch(`/token`, {
    method: "GET",
    headers: { oauthtoken, client_id: CLIENT_ID }
  });
  if (!step2.ok) {
    throw new ApiError(step2.status, "Token exchange failed.");
  }
  const nsToken = step2.headers.get("x-nostackai-token");
  if (!nsToken) {
    throw new ApiError(
      500,
      "Token exchange succeeded but the x-nostackai-token header was not readable (CORS expose-headers)."
    );
  }
  setToken(nsToken);
  let profile: Profile = {};
  try {
    profile = await step2.json();
  } catch {
    /* body optional */
  }
  return profile;
}

export function logout() {
  setToken(null);
}

export async function register(email: string, pwd: string, fn: string, ln: string) {
  return api.post(`/user/register`, { email, pwd, fn, ln }, { "x-api-key": API_KEY });
}

export async function forgotPassword(email: string) {
  return api.post(`/user/forgotpwd`, { email }, { "x-api-key": API_KEY });
}

export async function resetPassword(token: string, pwd: string) {
  return api.post(`/user/resetpwd`, { token, pwd }, { "x-api-key": API_KEY });
}

export async function changePassword(currentPwd: string, newPwd: string) {
  return api.put(`/user/changepwd`, { currentPwd, newPwd });
}

export async function getMyProfile(): Promise<Profile> {
  return api.get<Profile>(`/user/myprofile`);
}

export async function updateProfile(fields: { fn?: string; ln?: string; picurl?: string }) {
  // KNOWN PLATFORM BUG: the docs say the profile-image field is `picture`,
  // but the API actually expects `picurl`. We send `picurl` on purpose.
  return api.put(`/user/updateprofile`, fields);
}
