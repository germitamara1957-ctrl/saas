import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/lib/auth";
import { AuthProvider } from "@/lib/auth-provider";

// Eager: landing + login pages so first paint is fast for unauthenticated visitors.
import Landing from "@/pages/Landing";
import AdminLogin from "@/pages/admin/Login";
import PortalLogin from "@/pages/portal/Login";

// Lazy: everything else gets its own chunk to shrink the initial bundle.
const Privacy = lazy(() => import("@/pages/Privacy"));
const Terms = lazy(() => import("@/pages/Terms"));
const Status = lazy(() => import("@/pages/Status"));

const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const AdminDevelopers = lazy(() => import("@/pages/admin/Developers"));
const AdminDeveloperDetail = lazy(() => import("@/pages/admin/DeveloperDetail"));
const AdminApiKeys = lazy(() => import("@/pages/admin/ApiKeys"));
const AdminAnalytics = lazy(() => import("@/pages/admin/Analytics"));
const AdminPlans = lazy(() => import("@/pages/admin/Plans"));
const AdminProviders = lazy(() => import("@/pages/admin/Providers"));
const AdminPricing = lazy(() => import("@/pages/admin/Pricing"));
const AdminAuditLog = lazy(() => import("@/pages/admin/AuditLog"));
const AdminPromoCodes = lazy(() => import("@/pages/admin/PromoCodes"));
const AdminReferrals = lazy(() => import("@/pages/admin/Referrals"));
const AdminSettings = lazy(() => import("@/pages/admin/Settings"));
const AdminIncidents = lazy(() => import("@/pages/admin/Incidents"));

const PortalSignup = lazy(() => import("@/pages/portal/Signup"));
const PortalDashboard = lazy(() => import("@/pages/portal/Dashboard"));
const PortalUsage = lazy(() => import("@/pages/portal/Usage"));
const PortalApiKeys = lazy(() => import("@/pages/portal/ApiKeys"));
const PortalPlans = lazy(() => import("@/pages/portal/Plans"));
const PortalBilling = lazy(() => import("@/pages/portal/Billing"));
const PortalBillingResult = lazy(() => import("@/pages/portal/BillingResult"));
const PortalReferrals = lazy(() => import("@/pages/portal/Referrals"));
const PortalDocs = lazy(() => import("@/pages/portal/Docs"));
const PortalSettings = lazy(() => import("@/pages/portal/Settings"));
const PortalWebhooks = lazy(() => import("@/pages/portal/Webhooks"));
const PortalLogs = lazy(() => import("@/pages/portal/Logs"));
const ForgotPassword = lazy(() => import("@/pages/portal/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/portal/ResetPassword"));
const VerifyEmail = lazy(() => import("@/pages/portal/VerifyEmail"));
const Organizations = lazy(() => import("@/pages/portal/Organizations"));
const OrganizationDetail = lazy(() => import("@/pages/portal/OrganizationDetail"));
const AcceptInvite = lazy(() => import("@/pages/portal/AcceptInvite"));

const AdminLayout = lazy(() =>
  import("@/components/layout/AdminLayout").then((m) => ({ default: m.AdminLayout })),
);
const PortalLayout = lazy(() =>
  import("@/components/layout/PortalLayout").then((m) => ({ default: m.PortalLayout })),
);

import { AuthGuard } from "@/components/AuthGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RouteSkeleton } from "@/components/RouteSkeleton";

const queryClient = new QueryClient();

// Page-shaped skeleton placeholder for lazy-loaded routes (replaces the old
// centred spinner — keeps layout stable and reduces perceived loading time).
const RouteFallback = RouteSkeleton;

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
      <Suspense fallback={<RouteFallback />}>
        <AdminLayout>
          <Suspense fallback={<RouteFallback />}>
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
              <Route path="referrals" element={<AdminReferrals />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="incidents" element={<AdminIncidents />} />
            </Routes>
          </Suspense>
        </AdminLayout>
      </Suspense>
    </AuthGuard>
  );
}

function PortalRoutes() {
  return (
    <AuthGuard role="developer">
      <Suspense fallback={<RouteFallback />}>
        <PortalLayout>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route index element={<PortalDashboard />} />
              <Route path="dashboard" element={<PortalDashboard />} />
              <Route path="api-keys" element={<PortalApiKeys />} />
              <Route path="plans" element={<PortalPlans />} />
              <Route path="billing" element={<PortalBilling />} />
              <Route path="billing/result" element={<PortalBillingResult />} />
              <Route path="referrals" element={<PortalReferrals />} />
              <Route path="usage" element={<PortalUsage />} />
              <Route path="webhooks" element={<PortalWebhooks />} />
              <Route path="logs" element={<PortalLogs />} />
              <Route path="docs" element={<PortalDocs />} />
              <Route path="settings" element={<PortalSettings />} />
              <Route path="organizations" element={<Organizations />} />
              <Route path="organizations/:id" element={<OrganizationDetail />} />
            </Routes>
          </Suspense>
        </PortalLayout>
      </Suspense>
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
                <Suspense fallback={<RouteFallback />}>
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
                </Suspense>
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
