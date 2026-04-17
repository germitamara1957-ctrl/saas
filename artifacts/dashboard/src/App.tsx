import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/lib/auth";
import { AuthProvider } from "@/lib/auth-provider";

import Landing from "@/pages/Landing";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import Status from "@/pages/Status";

import AdminLogin from "@/pages/admin/Login";
import AdminDashboard from "@/pages/admin/Dashboard";
import AdminDevelopers from "@/pages/admin/Developers";
import AdminDeveloperDetail from "@/pages/admin/DeveloperDetail";
import AdminApiKeys from "@/pages/admin/ApiKeys";
import AdminAnalytics from "@/pages/admin/Analytics";
import AdminPlans from "@/pages/admin/Plans";
import AdminProviders from "@/pages/admin/Providers";
import AdminPricing from "@/pages/admin/Pricing";
import AdminAuditLog from "@/pages/admin/AuditLog";
import AdminPromoCodes from "@/pages/admin/PromoCodes";
import AdminSettings from "@/pages/admin/Settings";
import AdminIncidents from "@/pages/admin/Incidents";

import PortalLogin from "@/pages/portal/Login";
import PortalSignup from "@/pages/portal/Signup";
import PortalDashboard from "@/pages/portal/Dashboard";
import PortalUsage from "@/pages/portal/Usage";
import PortalApiKeys from "@/pages/portal/ApiKeys";
import PortalPlans from "@/pages/portal/Plans";
import PortalDocs from "@/pages/portal/Docs";
import PortalSettings from "@/pages/portal/Settings";
import PortalWebhooks from "@/pages/portal/Webhooks";
import PortalLogs from "@/pages/portal/Logs";
import ForgotPassword from "@/pages/portal/ForgotPassword";
import ResetPassword from "@/pages/portal/ResetPassword";
import VerifyEmail from "@/pages/portal/VerifyEmail";
import Organizations from "@/pages/portal/Organizations";
import OrganizationDetail from "@/pages/portal/OrganizationDetail";
import AcceptInvite from "@/pages/portal/AcceptInvite";

import { AdminLayout } from "@/components/layout/AdminLayout";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { AuthGuard } from "@/components/AuthGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const queryClient = new QueryClient();

function RootRedirect() {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return null;
  if (isAuthenticated && user?.role === "admin") return <Navigate to="/admin" replace />;
  if (isAuthenticated && user?.role === "developer") return <Navigate to="/portal" replace />;
  return <Landing />;
}

function AdminRoutes() {
  return (
    <AuthGuard role="admin">
      <AdminLayout>
        <Routes>
          <Route index element={<AdminDashboard />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="developers" element={<AdminDevelopers />} />
          <Route path="developers/:id" element={<AdminDeveloperDetail />} />
          <Route path="api-keys" element={<AdminApiKeys />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="plans" element={<AdminPlans />} />
          <Route path="providers" element={<AdminProviders />} />
          <Route path="pricing" element={<AdminPricing />} />
          <Route path="audit-log" element={<AdminAuditLog />} />
          <Route path="promo-codes" element={<AdminPromoCodes />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="incidents" element={<AdminIncidents />} /></Routes>
      </AdminLayout>
    </AuthGuard>
  );
}

function PortalRoutes() {
  return (
    <AuthGuard role="developer">
      <PortalLayout>
        <Routes>
          <Route index element={<PortalDashboard />} />
          <Route path="dashboard" element={<PortalDashboard />} />
          <Route path="api-keys" element={<PortalApiKeys />} />
          <Route path="plans" element={<PortalPlans />} />
          <Route path="usage" element={<PortalUsage />} />
          <Route path="webhooks" element={<PortalWebhooks />} />
          <Route path="logs" element={<PortalLogs />} />
          <Route path="docs" element={<PortalDocs />} />
          <Route path="settings" element={<PortalSettings />} />
          <Route path="organizations" element={<Organizations />} />
          <Route path="organizations/:id" element={<OrganizationDetail />} />
        </Routes>
      </PortalLayout>
    </AuthGuard>
  );
}

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <BrowserRouter basename={base}>
              <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<RootRedirect />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/admin/login" element={<AdminLogin />} />
                  <Route path="/admin/*" element={<AdminRoutes />} />
                  <Route path="/login" element={<PortalLogin />} />
                  <Route path="/portal/login" element={<PortalLogin />} />
                  <Route path="/signup" element={<PortalSignup />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/verify-email" element={<VerifyEmail />} />
                  <Route path="/status" element={<Status />} />
                  <Route path="/portal/invite/:token" element={<AcceptInvite />} />
                  <Route path="/portal/*" element={<PortalRoutes />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
                <Toaster />
              </ErrorBoundary>
            </BrowserRouter>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
