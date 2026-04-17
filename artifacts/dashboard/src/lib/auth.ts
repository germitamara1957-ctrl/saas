import { createContext, useContext } from "react";

export type Role = "admin" | "developer";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  emailVerified?: boolean;
  creditBalance?: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (user: AuthUser) => void;
  logout: (role?: Role) => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
