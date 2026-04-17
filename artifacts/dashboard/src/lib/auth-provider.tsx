import { useState, useEffect, useCallback, type ReactNode } from "react";
import { AuthContext, type AuthUser, type Role } from "./auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/me", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user ?? null);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = (userData: AuthUser) => {
    setUser(userData);
  };

  const logout = async (role?: Role) => {
    const path =
      role === "admin"
        ? "/api/admin/auth/logout"
        : "/api/portal/auth/logout";
    try {
      await fetch(path, { method: "POST", credentials: "include" });
    } catch {
      // ignore network errors on logout
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        login,
        logout,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
