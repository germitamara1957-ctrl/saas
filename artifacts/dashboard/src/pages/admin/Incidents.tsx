import { useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Trash2, Plus } from "lucide-react";

interface Incident {
  id: number;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  status: string;
  severity: string;
  startedAt: string;
  resolvedAt: string | null;
}

const STATUSES = ["investigating", "identified", "monitoring", "resolved"];
const SEVERITIES = ["minor", "major", "critical", "maintenance"];

export default function AdminIncidents() {
  const { t } = useTranslation();
  const isAr = i18n.language === "ar";
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Partial<Incident> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-incidents"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/incidents");
      if (!res.ok) throw new Error("Failed to load incidents");
      return (await res.json()) as { incidents: Incident[] };
    },
  });

  const save = useMutation({
    mutationFn: async (payload: Partial<Incident>) => {
      const url = payload.id ? `/admin/incidents/${payload.id}` : "/admin/incidents";
      const method = payload.id ? "PATCH" : "POST";
      const res = await authFetch(url, { method, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-incidents"] });
      setEditing(null);
      toast({ title: t("common.success") });
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const res = await authFetch(`/api/admin/incidents/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-incidents"] }),
  });

  return (
    <div className={`space-y-6 ${isAr ? "text-right" : ""}`}>
      <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : ""}`}>
        <div>
          <h1 className="text-2xl font-bold">{t("incidents.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("incidents.subtitle")}</p>
        </div>
        <Button onClick={() => setEditing({ status: "investigating", severity: "minor" })} className="gap-2">
          <Plus className="h-4 w-4" /> {t("incidents.new")}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("incidents.all")}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : data?.incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
          ) : (
            <div className="space-y-3">
              {data?.incidents.map((inc) => (
                <div key={inc.id} className={`border rounded-lg p-4 flex items-start justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{isAr ? inc.titleAr : inc.titleEn}</p>
                    <div className="flex gap-2 mt-2">
                      <Badge variant="outline">{t(`status.severity.${inc.severity}`)}</Badge>
                      <Badge variant="outline">{t(`status.statusValues.${inc.status}`)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(inc.startedAt).toLocaleString()}
                      {inc.resolvedAt ? ` → ${new Date(inc.resolvedAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(inc)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm(t("common.confirm"))) del.mutate(inc.id); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? t("incidents.edit") : t("incidents.new")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("incidents.titleEn")}</Label>
                <Input value={editing?.titleEn ?? ""} onChange={(e) => setEditing({ ...editing, titleEn: e.target.value })} />
              </div>
              <div>
                <Label>{t("incidents.titleAr")}</Label>
                <Input value={editing?.titleAr ?? ""} onChange={(e) => setEditing({ ...editing, titleAr: e.target.value })} dir="rtl" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("incidents.bodyEn")}</Label>
                <Textarea value={editing?.bodyEn ?? ""} onChange={(e) => setEditing({ ...editing, bodyEn: e.target.value })} rows={3} />
              </div>
              <div>
                <Label>{t("incidents.bodyAr")}</Label>
                <Textarea value={editing?.bodyAr ?? ""} onChange={(e) => setEditing({ ...editing, bodyAr: e.target.value })} dir="rtl" rows={3} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("incidents.status")}</Label>
                <Select value={editing?.status ?? "investigating"} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`status.statusValues.${s}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("incidents.severity")}</Label>
                <Select value={editing?.severity ?? "minor"} onValueChange={(v) => setEditing({ ...editing, severity: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{t(`status.severity.${s}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => save.mutate(editing!)} disabled={save.isPending}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
