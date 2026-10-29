import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import * as authService from "@/services/authService";
import { Access, checkAccess } from "@/services/accessService";
import { loadMyAccessRequest } from "@/services/accessRequestService";
import { checkAdmin } from "@/services/adminService";
import type { Profile } from "@/services/authService";
import { AUTH_EXPIRED_EVENT, getStoredToken, refreshToken, setToken } from "@/services/apiClient";

interface AuthState {
  profile: Profile | null;
  loggedIn: boolean;
  /** True while a saved session is being validated on startup. */
  restoring: boolean;
  /** Whether an admin has approved this account: "checking" until the backend has answered. */
  access: Access | "checking";
  /** Whether this person can manage who has access (null while that is still being checked). Only decides what the menu shows; the backend enforces the real rule. */
  isAdmin: boolean | null;
  /** Ask again (used by the awaiting-approval page). Resolves to the new answer. */
  refreshAccess: () => Promise<Access>;
  login: (email: string, pwd: string) => Promise<void>;
  logout: () => void;
  setProfile: (p: Profile) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [restoring, setRestoring] = useState(() => getStoredToken() !== null);
  const [access, setAccess] = useState<Access | "checking">("unknown");
  const [adminResult, setAdminResult] = useState<{ email: string | undefined; yes: boolean } | null>(null);

  const refreshAccess = async (): Promise<Access> => {
    const result = await checkAccess();
    setAccess(result);
    return result;
  };

  // Reopened tab / reload: pick the saved token back up and prove it's still
  // valid by loading the profile with it. Only a real auth failure (the API
  // client clears the token itself on an unrecoverable 401) logs the user out;
  // a network hiccup keeps the saved token for the next reload. The renewal
  // is best-effort and never decides whether the session survives.
  useEffect(() => {
    const saved = getStoredToken();
    if (!saved) return;
    let cancelled = false;
    (async () => {
      setToken(saved);
      try {
        const p = await authService.getMyProfile();
        if (cancelled) return;
        setProfile(p ?? {});
        setAccess("checking");
        void checkAccess().then((r) => !cancelled && setAccess(r));
        void refreshToken();
      } catch (e) {
        console.warn("[auth] couldn't restore the saved session:", e);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The admin answer is remembered with the account it belongs to, so signing in as someone else never shows the
  // previous person's answer while the new one is checked. It is asked for as soon as the account is known, in
  // parallel with the access check, so the Access link isn't waiting behind two requests in a row. Only a person
  // who is not waiting can be an admin, and the backend enforces that regardless of what is shown here.
  const email = profile?.email;
  const checkingAdmin = Boolean(profile) && access !== "pending" && access !== "unknown";
  useEffect(() => {
    if (!checkingAdmin) return;
    let cancelled = false;
    void checkAdmin().then((yes) => !cancelled && setAdminResult({ email, yes }));
    return () => {
      cancelled = true;
    };
  }, [checkingAdmin, email]);
  const isAdmin: boolean | null = access === "pending" ? false : checkingAdmin && adminResult && adminResult.email === email ? adminResult.yes : null;

  // Everyone's name and email is saved once, not only people who waited: it is the only way the Access page can show
  // who an approved member or admin is (the platform's user list is not readable from the app). Best effort.
  const fullName = [profile?.fn, profile?.ln].filter(Boolean).join(" ");
  useEffect(() => {
    if (access !== "approved" || !email) return;
    loadMyAccessRequest({ email, name: fullName }).catch(() => undefined);
  }, [access, email, fullName]);

  // A request found the session unrecoverable (refresh failed after a 401).
  useEffect(() => {
    const onExpired = () => {
      setProfile(null);
      setAccess("unknown");
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const login = async (email: string, pwd: string) => {
    const p = await authService.login(email, pwd);
    setAccess("checking");
    setProfile(p ?? {});
    void refreshAccess();
  };

  const logout = () => {
    authService.logout();
    setProfile(null);
    setAccess("unknown");
  };

  return (
    <AuthContext.Provider
      value={{ profile, loggedIn: profile !== null, restoring, access, isAdmin, refreshAccess, login, logout, setProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
