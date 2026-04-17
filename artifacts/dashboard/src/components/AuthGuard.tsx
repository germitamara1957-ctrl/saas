import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

interface AuthGuardProps {
  children: ReactNode;
  role: "admin" | "developer";
}

export function AuthGuard({ children, role }: AuthGuardProps) {
  const { isAuthenticated, user, loading } = useAuth();

  // Don't redirect while the initial auth check is in flight.
  // Without this guard, AuthGuard would always see user=null on first render
  // and redirect back to login, creating an infinite redirect loop.
  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to={role === "admin" ? "/admin/login" : "/login"} replace />;
  }

  if (user?.role !== role) {
    return <Navigate to={user?.role === "admin" ? "/admin" : "/portal"} replace />;
  }

  return <>{children}</>;
}
