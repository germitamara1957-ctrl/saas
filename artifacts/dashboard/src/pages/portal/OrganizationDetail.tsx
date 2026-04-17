import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Mail, Trash2, UserMinus, Copy } from "lucide-react";

interface Member {
  userId: number;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

interface OrgDetail {
  organization: {
    id: number; name: string; slug: string; role: string;
    creditBalance: number; topupCreditBalance: number;
    dailySpendLimitUsd: number | null; monthlySpendLimitUsd: number | null;
  };
  members: Member[];
}

interface OrgApiKey {
  id: number;
  name: string | null;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  createdByUserId: number;
}

interface Invite {
  id: number;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

const ROLES = ["admin", "developer", "viewer"];

export default function OrganizationDetail() {
  const { id } = useParams<{ id: string }>();
  const orgId = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const isAr = i18n.language === "ar";
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("developer");
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<{ fullKey: string; name: string | null } | null>(null);
  const [editingLimits, setEditingLimits] = useState(false);
  const [dailyCap, setDailyCap] = useState<string>("");
  const [monthlyCap, setMonthlyCap] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["portal-org", orgId],
    queryFn: async () => {
      const res = await authFetch(`/api/portal/organizations/${orgId}`);
      if (!res.ok) throw new Error("Failed to load");
      return (await res.json()) as OrgDetail;
    },
  });

  const isOwnerOrAdmin = data?.organization.role === "owner" || data?.organization.role === "admin";

  // ── Org API keys ──────────────────────────────────────────────────────────
  const { data: keysData } = useQuery({
    queryKey: ["portal-org-keys", orgId],
    queryFn: async () => {
      const res = await authFetch(`/api/portal/organizations/${orgId}/api-keys`);
      if (!res.ok) throw new Error("Failed to load");
      return (await res.json()) as { apiKeys: OrgApiKey[] };
    },
    enabled: Number.isFinite(orgId),
  });

  const createKey = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/portal/organizations/${orgId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed to create key");
      return d as { fullKey: string; name: string | null };
    },
    onSuccess: (d) => {
      setCreatedKey({ fullKey: d.fullKey, name: d.name });
      setCreatingKey(false);
      setNewKeyName("");
      qc.invalidateQueries({ queryKey: ["portal-org-keys", orgId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const revokeKey = useMutation({
    mutationFn: async (keyId: number) => {
      const res = await authFetch(`/api/portal/organizations/${orgId}/api-keys/${keyId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to revoke");
    },
    onSuccess: () => {
      toast({ title: "Key revoked" });
      qc.invalidateQueries({ queryKey: ["portal-org-keys", orgId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Org spending limits ───────────────────────────────────────────────────
  const saveLimits = useMutation({
    mutationFn: async () => {
      const body: Record<string, number | null> = {
        dailySpendLimitUsd: dailyCap === "" ? null : Number(dailyCap),
        monthlySpendLimitUsd: monthlyCap === "" ? null : Number(monthlyCap),
      };
      const res = await authFetch(`/api/portal/organizations/${orgId}/spending-limits`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed to save limits");
    },
    onSuccess: () => {
      toast({ title: "Spending limits updated" });
      setEditingLimits(false);
      qc.invalidateQueries({ queryKey: ["portal-org", orgId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: invitesData } = useQuery({
    queryKey: ["portal-org-invites", orgId],
    queryFn: async () => {
      const res = await authFetch(`/api/portal/organizations/${orgId}/invites`);
      if (!res.ok) throw new Error("Failed to load");
      return (await res.json()) as { invites: Invite[] };
    },
    enabled: !!isOwnerOrAdmin,
  });

  const sendInvite = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/portal/organizations/${orgId}/invites`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-org-invites", orgId] });
      setInviting(false); setInviteEmail("");
      toast({ title: t("orgs.invite.sent") });
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const revokeInvite = useMutation({
    mutationFn: async (inviteId: number) => {
      const res = await authFetch(`/api/portal/organizations/${orgId}/invites/${inviteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-org-invites", orgId] }),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: number) => {
      const res = await authFetch(`/api/portal/organizations/${orgId}/members/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-org", orgId] }),
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const changeRole = useMutation({
    mutationFn: async (params: { userId: number; role: string }) => {
      const res = await authFetch(`/api/portal/organizations/${orgId}/members/${params.userId}`, {
        method: "PATCH", body: JSON.stringify({ role: params.role }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-org", orgId] }),
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const rename = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/portal/organizations/${orgId}`, { method: "PATCH", body: JSON.stringify({ name: newName }) });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-org", orgId] });
      qc.invalidateQueries({ queryKey: ["portal-orgs"] });
      setRenaming(false);
    },
  });

  const deleteOrg = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/portal/organizations/${orgId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-orgs"] });
      navigate("/portal/organizations");
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (!data) return <p className="text-sm text-destructive">{t("common.error")}</p>;

  const { organization, members } = data;
  const inviteUrlBase = window.location.origin + (import.meta.env.BASE_URL || "/");

  return (
    <div className={`space-y-6 ${isAr ? "text-right" : ""}`}>
      <Button variant="ghost" onClick={() => navigate("/portal/organizations")} className="gap-2">
        <ArrowLeft className={`h-4 w-4 ${isAr ? "rotate-180" : ""}`} /> {t("common.back")}
      </Button>

      <div>
        <h1 className="text-2xl font-bold">{organization.name}</h1>
        <p className="text-sm text-muted-foreground">{organization.slug} · <Badge variant="outline">{t(`orgs.role.${organization.role}`)}</Badge></p>
      </div>

      <Card>
        <CardHeader>
          <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : ""}`}>
            <CardTitle>{t("orgs.members")}</CardTitle>
            {isOwnerOrAdmin && (
              <Button size="sm" onClick={() => setInviting(true)} className="gap-2">
                <Mail className="h-4 w-4" /> {t("orgs.invite.button")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.userId} className={`border rounded-lg p-3 flex items-center justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                <div className={isAr ? "text-right" : ""}>
                  <p className="font-medium text-sm">{m.name || m.email}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
                <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                  {isOwnerOrAdmin && m.role !== "owner" ? (
                    <Select value={m.role} onValueChange={(v) => changeRole.mutate({ userId: m.userId, role: v })}>
                      <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r} value={r}>{t(`orgs.role.${r}`)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline">{t(`orgs.role.${m.role}`)}</Badge>
                  )}
                  {isOwnerOrAdmin && m.role !== "owner" && (
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm(t("common.confirm"))) removeMember.mutate(m.userId); }}>
                      <UserMinus className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {isOwnerOrAdmin && (
        <Card>
          <CardHeader><CardTitle>{t("orgs.pendingInvites")}</CardTitle></CardHeader>
          <CardContent>
            {!invitesData?.invites.length ? (
              <p className="text-sm text-muted-foreground">{t("orgs.noPendingInvites")}</p>
            ) : (
              <div className="space-y-2">
                {invitesData.invites.map((inv) => {
                  const link = `${inviteUrlBase}portal/invite/${inv.token}`;
                  return (
                    <div key={inv.id} className={`border rounded-lg p-3 ${isAr ? "text-right" : ""}`}>
                      <div className={`flex items-center justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                        <div>
                          <p className="text-sm font-medium">{inv.email}</p>
                          <p className="text-xs text-muted-foreground">
                            {t(`orgs.role.${inv.role}`)} · {t("orgs.expires")} {new Date(inv.expiresAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                          <Button variant="ghost" size="icon" onClick={() => { navigator.clipboard.writeText(link); toast({ title: t("common.copied") }); }}>
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => revokeInvite.mutate(inv.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      <code className="block mt-2 text-xs text-muted-foreground break-all">{link}</code>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── API Keys ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>API Keys</CardTitle>
          {isOwnerOrAdmin && (
            <Button size="sm" onClick={() => { setNewKeyName(""); setCreatingKey(true); }}>
              Create Key
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!keysData?.apiKeys.length ? (
            <p className="text-sm text-muted-foreground">No organization API keys yet. Keys created here debit the organization's credit pool, not individual members.</p>
          ) : (
            <div className="space-y-2">
              {keysData.apiKeys.map((k) => (
                <div key={k.id} className="border rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{k.name || "Unnamed Key"}</p>
                      {k.isActive
                        ? <Badge variant="outline" className="text-[10px]">Active</Badge>
                        : <Badge variant="secondary" className="text-[10px]">Revoked</Badge>}
                    </div>
                    <code className="block text-xs text-muted-foreground mt-0.5">{k.keyPrefix}…</code>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Created {new Date(k.createdAt).toLocaleDateString()} · Last used {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "never"}
                    </p>
                  </div>
                  {isOwnerOrAdmin && k.isActive && (
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("Revoke this key? Apps using it will stop working immediately.")) revokeKey.mutate(k.id); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Spending Limits ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Spending Limits</CardTitle>
          {isOwnerOrAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDailyCap(organization.dailySpendLimitUsd?.toString() ?? "");
                setMonthlyCap(organization.monthlySpendLimitUsd?.toString() ?? "");
                setEditingLimits(true);
              }}
            >
              Edit
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Daily cap (USD)</p>
              <p className="text-lg font-semibold">{organization.dailySpendLimitUsd != null ? `$${organization.dailySpendLimitUsd.toFixed(2)}` : "No limit"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Monthly cap (USD)</p>
              <p className="text-lg font-semibold">{organization.monthlySpendLimitUsd != null ? `$${organization.monthlySpendLimitUsd.toFixed(2)}` : "No limit"}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">When a cap is reached, all org API keys return HTTP 429 until the period resets or the cap is raised.</p>
        </CardContent>
      </Card>

      {organization.role === "owner" && (
        <Card>
          <CardHeader><CardTitle>{t("orgs.dangerZone")}</CardTitle></CardHeader>
          <CardContent className={`flex flex-wrap gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
            <Button variant="outline" onClick={() => { setNewName(organization.name); setRenaming(true); }}>{t("orgs.rename")}</Button>
            <Button variant="destructive" onClick={() => { if (confirm(t("orgs.confirmDelete"))) deleteOrg.mutate(); }}>
              {t("orgs.delete")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("orgs.invite.button")}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>{t("common.email")}</Label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@example.com" />
            </div>
            <div>
              <Label>{t("orgs.role.label")}</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{t(`orgs.role.${r}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviting(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => sendInvite.mutate()} disabled={!inviteEmail || sendInvite.isPending}>{t("orgs.invite.send")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creatingKey} onOpenChange={setCreatingKey}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Organization API Key</DialogTitle></DialogHeader>
          <div className="grid gap-2">
            <Label>Name (optional)</Label>
            <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="e.g. Production, CI" />
            <p className="text-xs text-muted-foreground">This key will debit the organization's credit pool on every call.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatingKey(false)}>Cancel</Button>
            <Button onClick={() => createKey.mutate()} disabled={createKey.isPending}>
              {createKey.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdKey} onOpenChange={(o) => { if (!o) setCreatedKey(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>API Key Created</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Copy this key now — it will not be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-muted rounded text-xs font-mono break-all">{createdKey?.fullKey}</code>
              <Button variant="outline" size="icon" onClick={() => { if (createdKey) { navigator.clipboard.writeText(createdKey.fullKey); toast({ title: "Copied" }); } }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>I've saved my key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingLimits} onOpenChange={setEditingLimits}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Spending Limits</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Daily cap (USD)</Label>
              <Input type="number" min="0" step="0.01" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} placeholder="No limit" />
            </div>
            <div>
              <Label>Monthly cap (USD)</Label>
              <Input type="number" min="0" step="0.01" value={monthlyCap} onChange={(e) => setMonthlyCap(e.target.value)} placeholder="No limit" />
            </div>
            <p className="text-xs text-muted-foreground">Leave blank to remove a cap.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLimits(false)}>Cancel</Button>
            <Button onClick={() => saveLimits.mutate()} disabled={saveLimits.isPending}>
              {saveLimits.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("orgs.rename")}</DialogTitle></DialogHeader>
          <div className="grid gap-2">
            <Label>{t("orgs.name")}</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => rename.mutate()} disabled={!newName.trim()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
