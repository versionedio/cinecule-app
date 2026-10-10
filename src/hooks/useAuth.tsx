import { createContext, useContext, useState, ReactNode } from "react";
import * as authService from "@/services/authService";
import type { Profile } from "@/services/authService";

interface AuthState {
  profile: Profile | null;
  loggedIn: boolean;
  login: (email: string, pwd: string) => Promise<void>;
  logout: () => void;
  setProfile: (p: Profile) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);

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
      value={{ profile, loggedIn: profile !== null, login, logout, setProfile }}
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
