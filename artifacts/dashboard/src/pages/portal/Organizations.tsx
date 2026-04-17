import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Users, ChevronRight } from "lucide-react";

interface Organization {
  id: number;
  name: string;
  slug: string;
  role: string;
  creditBalance: number;
  topupCreditBalance: number;
  createdAt: string;
}

export default function Organizations() {
  const { t } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["portal-orgs"],
    queryFn: async () => {
      const res = await authFetch("/api/portal/organizations");
      if (!res.ok) throw new Error("Failed to load");
      return (await res.json()) as { organizations: Organization[] };
    },
  });

  const create = useMutation({
    mutationFn: async (n: string) => {
      const res = await authFetch("/api/portal/organizations", { method: "POST", body: JSON.stringify({ name: n }) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      return (await res.json()) as { organization: Organization };
    },
    onSuccess: (json) => {
      qc.invalidateQueries({ queryKey: ["portal-orgs"] });
      setCreating(false);
      setName("");
      toast({ title: t("common.success") });
      navigate(`/portal/organizations/${json.organization.id}`);
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  return (
    <div className={`space-y-6 ${isAr ? "text-right" : ""}`}>
      <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : ""}`}>
        <div>
          <h1 className="text-2xl font-bold">{t("orgs.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("orgs.subtitle")}</p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" /> {t("orgs.create")}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("orgs.mine")}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : !data?.organizations.length ? (
            <p className="text-sm text-muted-foreground">{t("orgs.empty")}</p>
          ) : (
            <div className="space-y-2">
              {data.organizations.map((org) => (
                <button
                  key={org.id}
                  onClick={() => navigate(`/portal/organizations/${org.id}`)}
                  className={`w-full border rounded-lg p-4 hover:bg-muted/50 transition-colors flex items-center justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}
                >
                  <div className={`flex items-center gap-3 ${isAr ? "flex-row-reverse text-right" : "text-left"}`}>
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{org.name}</p>
                      <p className="text-xs text-muted-foreground">{org.slug}</p>
                    </div>
                  </div>
                  <div className={`flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                    <Badge variant="outline">{t(`orgs.role.${org.role}`)}</Badge>
                    <ChevronRight className={`h-4 w-4 text-muted-foreground ${isAr ? "rotate-180" : ""}`} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("orgs.create")}</DialogTitle></DialogHeader>
          <div className="grid gap-2">
            <Label>{t("orgs.name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => create.mutate(name)} disabled={create.isPending || !name.trim()}>{t("common.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
