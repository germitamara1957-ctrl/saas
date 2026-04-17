import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Tag, Copy, Check } from "lucide-react";
import i18n from "@/i18n";

type PromoCode = {
  id: number;
  code: string;
  creditsAmount: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
  note: string | null;
  createdAt: string;
};

type FormValues = {
  code: string;
  creditsAmount: string;
  maxUses: string;
  expiresAt: string;
  note: string;
  isActive: boolean;
};

const emptyForm: FormValues = {
  code: "",
  creditsAmount: "",
  maxUses: "100",
  expiresAt: "",
  note: "",
  isActive: true,
};

async function fetchCodes(): Promise<PromoCode[]> {
  const res = await authFetch("/api/admin/promo-codes");
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

function usePromoCodes() {
  return useQuery({ queryKey: ["admin-promo-codes"], queryFn: fetchCodes });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="ml-1 text-muted-foreground hover:text-foreground transition-colors">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function getCodeStatus(code: PromoCode) {
  if (!code.isActive) return "inactive";
  if (code.expiresAt && new Date(code.expiresAt) < new Date()) return "expired";
  if (code.usedCount >= code.maxUses) return "exhausted";
  return "active";
}

export default function AdminPromoCodes() {
  const { t } = useTranslation();
  const isAr = i18n.language === "ar";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: codes = [], isLoading } = usePromoCodes();

  const [createOpen, setCreateOpen] = useState(false);
  const [editCode, setEditCode] = useState<PromoCode | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-promo-codes"] });

  const openCreate = () => {
    setForm(emptyForm);
    setCreateOpen(true);
  };

  const openEdit = (code: PromoCode) => {
    setEditCode(code);
    setForm({
      code: code.code,
      creditsAmount: String(code.creditsAmount),
      maxUses: String(code.maxUses),
      expiresAt: code.expiresAt ? code.expiresAt.split("T")[0] : "",
      note: code.note ?? "",
      isActive: code.isActive,
    });
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.creditsAmount || !form.maxUses) {
      toast({ title: t("common.error"), description: "Code, credits, and max uses are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const body = {
        code: form.code.trim().toUpperCase(),
        creditsAmount: parseFloat(form.creditsAmount),
        maxUses: parseInt(form.maxUses, 10),
        expiresAt: form.expiresAt ? new Date(form.expiresAt + "T23:59:59Z").toISOString() : null,
        note: form.note.trim() || null,
        isActive: form.isActive,
      };
      const url = editCode ? `/api/admin/promo-codes/${editCode.id}` : "/api/admin/promo-codes";
      const method = editCode ? "PATCH" : "POST";
      const res = await authFetch(url, { method, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: t("common.error"), description: data.error || "Request failed", variant: "destructive" });
        return;
      }
      toast({ title: t("common.success") });
      invalidate();
      setCreateOpen(false);
      setEditCode(null);
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (code: PromoCode) => {
    const res = await authFetch(`/api/admin/promo-codes/${code.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !code.isActive }),
    });
    if (res.ok) invalidate();
  };

  const handleDelete = async () => {
    if (deleteId === null) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/api/admin/promo-codes/${deleteId}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: t("common.success") });
        invalidate();
        setDeleteId(null);
      }
    } finally {
      setDeleting(false);
    }
  };

  const statusBadge = (code: PromoCode) => {
    const s = getCodeStatus(code);
    if (s === "active") return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs">{t("common.active")}</Badge>;
    if (s === "inactive") return <Badge variant="secondary" className="text-xs">{t("common.inactive")}</Badge>;
    if (s === "expired") return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs">{t("promoCodes.expired")}</Badge>;
    return <Badge className="bg-red-500/10 text-red-600 border-red-500/20 text-xs">{t("promoCodes.exhausted")}</Badge>;
  };

  return (
    <div className="space-y-6" dir={isAr ? "rtl" : "ltr"}>
      <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : ""}`}>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("promoCodes.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("promoCodes.subtitle")}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className={`h-4 w-4 ${isAr ? "ml-2" : "mr-2"}`} />
          {t("promoCodes.createCode")}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">{t("common.loading")}</div>
      ) : codes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <Tag className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground">{t("promoCodes.noCodes")}</p>
            <Button variant="outline" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" /> {t("promoCodes.createCode")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {codes.map((code) => {
            const pct = Math.min(100, Math.round((code.usedCount / code.maxUses) * 100));
            return (
              <Card key={code.id} className={`flex flex-col ${!code.isActive ? "opacity-60" : ""}`}>
                <CardHeader className="pb-2">
                  <div className={`flex items-start justify-between gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                    <div className="min-w-0">
                      <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                        <CardTitle className="text-base font-mono tracking-widest">{code.code}</CardTitle>
                        <CopyButton text={code.code} />
                      </div>
                      {code.note && <CardDescription className="mt-0.5 text-xs truncate">{code.note}</CardDescription>}
                    </div>
                    <div className={`flex items-center gap-1 shrink-0 ${isAr ? "flex-row-reverse" : ""}`}>
                      {statusBadge(code)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-3">
                  <div className={`flex items-center justify-between text-sm ${isAr ? "flex-row-reverse" : ""}`}>
                    <span className="text-muted-foreground">{t("promoCodes.creditsAmount")}</span>
                    <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">${code.creditsAmount}</span>
                  </div>

                  <div>
                    <div className={`flex items-center justify-between text-xs text-muted-foreground mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
                      <span>{t("promoCodes.usedCount")}</span>
                      <span className="font-mono">{t("promoCodes.usage", { used: code.usedCount, max: code.maxUses })}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {code.expiresAt && (
                    <div className={`flex items-center justify-between text-xs ${isAr ? "flex-row-reverse" : ""}`}>
                      <span className="text-muted-foreground">{t("promoCodes.expiresAt")}</span>
                      <span className="font-mono">{new Date(code.expiresAt).toLocaleDateString()}</span>
                    </div>
                  )}

                  <div className={`flex items-center justify-between pt-1 border-t ${isAr ? "flex-row-reverse" : ""}`}>
                    <Switch checked={code.isActive} onCheckedChange={() => handleToggle(code)} />
                    <div className={`flex gap-1 ${isAr ? "flex-row-reverse" : ""}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(code)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteId(code.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={createOpen || !!editCode} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setEditCode(null); } }}>
        <DialogContent className="sm:max-w-md" dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{editCode ? t("promoCodes.editCode") : t("promoCodes.createCode")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("promoCodes.code")}</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder={t("promoCodes.codePlaceholder")}
                className="font-mono tracking-widest uppercase"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("promoCodes.creditsAmount")}</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.creditsAmount}
                  onChange={(e) => setForm((f) => ({ ...f, creditsAmount: e.target.value }))}
                  placeholder="10.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("promoCodes.maxUses")}</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={form.maxUses}
                  onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))}
                  placeholder="100"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("promoCodes.expiresAt")} <span className="text-muted-foreground text-xs">({t("promoCodes.noExpiry")})</span></Label>
              <Input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("promoCodes.note")}</Label>
              <Input
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder={t("promoCodes.notePlaceholder")}
              />
            </div>
            <div className={`flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
              <Switch
                id="promo-active"
                checked={form.isActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              />
              <Label htmlFor="promo-active">{t("common.active")}</Label>
            </div>
          </div>
          <DialogFooter className={isAr ? "flex-row-reverse" : ""}>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditCode(null); }}>{t("common.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? t("common.loading") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <DialogContent className="sm:max-w-sm" dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("common.delete")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("promoCodes.deleteConfirm")}</p>
          <DialogFooter className={isAr ? "flex-row-reverse" : ""}>
            <Button variant="outline" onClick={() => setDeleteId(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? t("common.loading") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
