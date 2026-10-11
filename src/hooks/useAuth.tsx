import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import * as authService from "@/services/authService";
import type { Profile } from "@/services/authService";
import { AUTH_EXPIRED_EVENT, getStoredToken, refreshToken, setToken } from "@/services/apiClient";

interface AuthState {
  profile: Profile | null;
  loggedIn: boolean;
  /** True while a saved session is being validated on startup. */
  restoring: boolean;
  login: (email: string, pwd: string) => Promise<void>;
  logout: () => void;
  setProfile: (p: Profile) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [restoring, setRestoring] = useState(() => getStoredToken() !== null);

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

  // A request found the session unrecoverable (refresh failed after a 401).
  useEffect(() => {
    const onExpired = () => setProfile(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const login = async (email: string, pwd: string) => {
    const p = await authService.login(email, pwd);
    setProfile(p ?? {});
  };

  const logout = () => {
    authService.logout();
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{ profile, loggedIn: profile !== null, restoring, login, logout, setProfile }}
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
