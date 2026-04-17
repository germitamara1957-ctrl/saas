import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/authFetch";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, loading } = useAuth();
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setState("loading");
    setError(null);
    try {
      const res = await authFetch(`/api/portal/organizations/invites/${token}/accept`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      const json = await res.json() as { organizationId: number };
      setState("success");
      setTimeout(() => navigate(`/portal/organizations/${json.organizationId}`), 1000);
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate(`/login?redirect=/portal/invite/${token}`);
    }
  }, [loading, isAuthenticated, token, navigate]);

  if (loading || !isAuthenticated) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/40">
      <Card className="max-w-md w-full">
        <CardHeader><CardTitle>{t("orgs.invite.acceptTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("orgs.invite.acceptDesc")}</p>
          {state === "error" && <p className="text-sm text-destructive">{error}</p>}
          {state === "success" && <p className="text-sm text-green-600">{t("common.success")}</p>}
          <Button onClick={accept} disabled={state === "loading" || state === "success"} className="w-full">
            {state === "loading" ? t("common.loading") : t("orgs.invite.accept")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
