import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  useGetUser,
  useListApiKeys,
  useListAnalyticsUsage,
  useCreateApiKey,
  useRevokeApiKey,
  useUpdateApiKey,
  useListPlans,
  getGetUserQueryKey,
  getListApiKeysQueryKey,
  getListAnalyticsUsageQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { format } from "date-fns";
import {
  Copy, Plus, Trash2, ArrowLeft, Key, CheckCircle2, AlertCircle,
  Pencil, Coins, ArrowUpCircle, ShieldCheck, Activity, TrendingUp,
  BarChart2, Zap, XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ApiKey } from "@workspace/api-client-react";
import { getModel } from "@/lib/models";

interface UserSummary {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalSpend: number;
  monthCalls: number;
  monthSpend: number;
  totalCreditsRemaining: number;
  activeKeyCount: number;
  topModels: { model: string; calls: number; spend: number }[];
  dailyUsage: { date: string; calls: number; spend: number }[];
}

const createKeySchema = z.object({
  name: z.string().min(1, "Name is required"),
  planId: z.string().min(1, "Plan is required"),
});

const editKeySchema = z.object({
  planId: z.string().min(1, "Plan is required"),
  creditBalance: z.coerce.number().min(0, "Balance must be non-negative"),
});

const addCreditsSchema = z.object({
  amount: z.coerce.number().refine((v) => v !== 0, "Amount cannot be zero"),
});

const upgradePlanSchema = z.object({
  planId: z.string().min(1, "Plan is required"),
  applyToAll: z.boolean().default(true),
});

// Shows allowed models for a given plan as coloured badges
function PlanModelBadges({ modelsAllowed }: { modelsAllowed: string[] }) {
  if (!modelsAllowed || modelsAllowed.length === 0) {
    return <p className="text-xs text-muted-foreground">No models assigned</p>;
  }
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {modelsAllowed.map((id) => {
        const m = getModel(id);
        return (
          <Badge key={id} variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
            {m?.displayName ?? id}
          </Badge>
        );
      })}
    </div>
  );
}

export default function AdminDeveloperDetail() {
  const params = useParams<{ id: string }>();
  const userId = parseInt(params.id ?? "0", 10);
  const { toast } = useToast();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [revokeKeyId, setRevokeKeyId] = useState<number | null>(null);
  const [addCreditsOpen, setAddCreditsOpen] = useState(false);
  const [upgradePlanOpen, setUpgradePlanOpen] = useState(false);
  const [isAddCreditsPending, setIsAddCreditsPending] = useState(false);
  const [isUpgradePlanPending, setIsUpgradePlanPending] = useState(false);
  const [isVerifyEmailPending, setIsVerifyEmailPending] = useState(false);

  // Track selected plan ID in edit / upgrade dialogs to preview models
  const [editSelectedPlanId, setEditSelectedPlanId] = useState<string>("");
  const [upgradeSelectedPlanId, setUpgradeSelectedPlanId] = useState<string>("");

  const { data: user, isLoading: userLoading } = useGetUser(userId, {
    query: { enabled: !!userId, queryKey: getGetUserQueryKey(userId) },
  });

  const { data: apiKeysData, isLoading: keysLoading } = useListApiKeys({ userId }, {
    query: { enabled: !!userId, queryKey: getListApiKeysQueryKey({ userId }) },
  });

  const { data: usageData, isLoading: usageLoading } = useListAnalyticsUsage({ userId, limit: 10 }, {
    query: { enabled: !!userId, queryKey: getListAnalyticsUsageQueryKey({ userId, limit: 10 }) },
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<UserSummary>({
    queryKey: ["user-summary", userId],
    queryFn: async () => {
      const res = await authFetch(`/api/admin/analytics/user-summary?userId=${userId}`);
      if (!res.ok) throw new Error("Failed to load summary");
      return res.json() as Promise<UserSummary>;
    },
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  const { data: plans } = useListPlans();

  const createApiKey = useCreateApiKey();
  const revokeApiKey = useRevokeApiKey();
  const updateApiKey = useUpdateApiKey();

  const createForm = useForm<z.infer<typeof createKeySchema>>({
    resolver: zodResolver(createKeySchema),
    defaultValues: { name: "", planId: "" },
  });

  const editForm = useForm<z.infer<typeof editKeySchema>>({
    resolver: zodResolver(editKeySchema),
    defaultValues: { planId: "", creditBalance: 0 },
  });

  const addCreditsForm = useForm<z.infer<typeof addCreditsSchema>>({
    resolver: zodResolver(addCreditsSchema),
    defaultValues: { amount: 100 },
  });

  const upgradePlanForm = useForm<z.infer<typeof upgradePlanSchema>>({
    resolver: zodResolver(upgradePlanSchema),
    defaultValues: { planId: "", applyToAll: true },
  });

  const activeKeys = apiKeysData?.items.filter((k) => k.isActive && !k.revokedAt) ?? [];

  const onCreateSubmit = (data: z.infer<typeof createKeySchema>) => {
    createApiKey.mutate(
      { data: { userId, planId: parseInt(data.planId), name: data.name } },
      {
        onSuccess: (res) => {
          setGeneratedKey(res.rawKey);
          queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey({ userId }) });
          createForm.reset();
        },
        onError: (err) => {
          toast({ title: "Error creating API key", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const onEditSubmit = (data: z.infer<typeof editKeySchema>) => {
    if (!editingKey) return;
    updateApiKey.mutate(
      { id: editingKey.id, data: { planId: parseInt(data.planId), creditBalance: data.creditBalance } },
      {
        onSuccess: () => {
          toast({ title: "API key updated" });
          queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey({ userId }) });
          setEditingKey(null);
        },
        onError: (err) => {
          toast({ title: "Error updating key", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const openEditDialog = (key: ApiKey) => {
    setEditingKey(key);
    setEditSelectedPlanId(key.planId.toString());
    editForm.reset({ planId: key.planId.toString(), creditBalance: key.creditBalance });
  };

  const handleRevoke = (keyId: number) => {
    setRevokeKeyId(keyId);
  };

  const confirmRevoke = () => {
    if (revokeKeyId === null) return;
    revokeApiKey.mutate(
      { id: revokeKeyId },
      {
        onSuccess: () => {
          toast({ title: "API key revoked" });
          queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey({ userId }) });
          queryClient.invalidateQueries({ queryKey: ["user-summary", userId] });
        },
        onError: (err) => {
          toast({ title: "Error revoking key", description: err.message, variant: "destructive" });
        },
        onSettled: () => setRevokeKeyId(null),
      }
    );
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Copied to clipboard" });
  };

  const closeCreateDialog = () => {
    setCreateDialogOpen(false);
    setGeneratedKey(null);
  };

  const onAddCreditsSubmit = async (data: z.infer<typeof addCreditsSchema>) => {
    setIsAddCreditsPending(true);
    try {
      await authFetch(`/api/admin/users/${userId}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: data.amount }),
      });
      toast({ title: t("admin.credits.added") });
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
      queryClient.invalidateQueries({ queryKey: ["user-summary", userId] });
      setAddCreditsOpen(false);
      addCreditsForm.reset();
    } catch (err: any) {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    } finally {
      setIsAddCreditsPending(false);
    }
  };

  const onUpgradePlanSubmit = async (data: z.infer<typeof upgradePlanSchema>) => {
    const planId = parseInt(data.planId);
    setIsUpgradePlanPending(true);
    try {
      const result = await authFetch(`/api/admin/users/${userId}/upgrade-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const body = await result.json();
      const planName = body.planName ?? plans?.find((p) => p.id === planId)?.name ?? "selected plan";
      toast({ title: `Plan upgraded to ${planName}`, description: `${body.keysUpdated} key(s) updated · +$${body.creditsAdded?.toFixed(2)} credits added to account` });
      queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey({ userId }) });
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
      queryClient.invalidateQueries({ queryKey: ["user-summary", userId] });
      setUpgradePlanOpen(false);
      upgradePlanForm.reset();
      setUpgradeSelectedPlanId("");
    } catch (err: any) {
      toast({ title: "Error upgrading plan", description: err.message, variant: "destructive" });
    } finally {
      setIsUpgradePlanPending(false);
    }
  };

  const [isSubPending, setIsSubPending] = useState(false);
  const onExtendSubscription = async (days: number) => {
    setIsSubPending(true);
    try {
      const res = await authFetch(`/api/admin/users/${userId}/subscription/extend`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }),
      });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Failed");
      toast({ title: "Subscription extended", description: `Added ${days} day(s).` });
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setIsSubPending(false); }
  };
  const onEndSubscription = async () => {
    if (!confirm("End this user's subscription immediately? Their plan-exclusive models will be blocked until you extend.")) return;
    setIsSubPending(true);
    try {
      const res = await authFetch(`/api/admin/users/${userId}/subscription/end`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Failed");
      toast({ title: "Subscription ended" });
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setIsSubPending(false); }
  };

  const onVerifyEmail = async () => {
    setIsVerifyEmailPending(true);
    try {
      const res = await authFetch(`/api/admin/users/${userId}/verify-email`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? "Failed to verify email");
      }
      toast({ title: "Email verified", description: "The developer can now make API calls." });
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
    } catch (err: any) {
      toast({ title: "Error verifying email", description: err.message, variant: "destructive" });
    } finally {
      setIsVerifyEmailPending(false);
    }
  };

  const editSelectedPlan = plans?.find((p) => p.id.toString() === editSelectedPlanId);
  const upgradeSelectedPlan = plans?.find((p) => p.id.toString() === upgradeSelectedPlanId);

  if (userLoading) return <div className="p-8 text-center text-muted-foreground">Loading developer details...</div>;
  if (!user) return <div className="p-8 text-center text-destructive">Developer not found.</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <Link to="/admin/developers">
          <Button variant="ghost" size="icon" data-testid="button-back"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{user.name}</h1>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {user.isActive ? (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Active</Badge>
          ) : (
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">Inactive</Badge>
          )}
          {/* Top-level action buttons */}
          {!user.emailVerified && (
            <Button
              variant="outline"
              size="sm"
              onClick={onVerifyEmail}
              disabled={isVerifyEmailPending}
              className="border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
              data-testid="button-verify-email"
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              {isVerifyEmailPending ? "Verifying..." : "Verify Email"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddCreditsOpen(true)}
            data-testid="button-add-credits-header"
            title="Add to top-up credit (works on all models)"
          >
            <Coins className="mr-2 h-4 w-4" /> Add Top-up Credit
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setUpgradePlanOpen(true);
              setUpgradeSelectedPlanId("");
              upgradePlanForm.reset({ planId: "", applyToAll: true });
            }}
            data-testid="button-upgrade-plan-header"
          >
            <ArrowUpCircle className="mr-2 h-4 w-4" /> Upgrade Plan
          </Button>
        </div>
      </div>

      {/* ── Account Balances (split) ─────────────────────────────── */}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground">Subscription Credit</p>
              <ShieldCheck className="h-4 w-4 text-primary" />
            </div>
            <p className="text-xl font-bold tracking-tight">
              ${((user as unknown as { creditBalance?: number }).creditBalance ?? 0).toFixed(4)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Granted by plan upgrade · restricted to plan models
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground">Top-up Credit</p>
              <Coins className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-xl font-bold tracking-tight">
              ${((user as unknown as { topupCreditBalance?: number }).topupCreditBalance ?? 0).toFixed(4)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Added via "Add Top-up Credit" · works on all models
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Subscription Period ──────────────────────────────────── */}
      {(() => {
        const periodEnd = (user as unknown as { currentPeriodEnd?: string | null }).currentPeriodEnd;
        const planId = (user as unknown as { currentPlanId?: number | null }).currentPlanId;
        const periodEndMs = periodEnd ? new Date(periodEnd).getTime() : null;
        const expired = periodEndMs != null && periodEndMs <= Date.now();
        const daysLeft = periodEndMs != null ? Math.ceil((periodEndMs - Date.now()) / (24 * 60 * 60 * 1000)) : null;
        return (
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Subscription Period</p>
                  {!planId ? (
                    <p className="text-sm mt-1">No plan assigned</p>
                  ) : !periodEnd ? (
                    <p className="text-sm mt-1">No period set (legacy account)</p>
                  ) : expired ? (
                    <p className="text-sm mt-1">
                      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 mr-2">Expired</Badge>
                      Ended {new Date(periodEnd).toLocaleDateString()}
                    </p>
                  ) : (
                    <p className="text-sm mt-1">
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 mr-2">Active</Badge>
                      Until {new Date(periodEnd).toLocaleDateString()} ({daysLeft} day{daysLeft === 1 ? "" : "s"} left)
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onExtendSubscription(30)} disabled={isSubPending} data-testid="button-extend-subscription">
                    Extend 30 days
                  </Button>
                  {periodEnd && !expired && (
                    <Button size="sm" variant="outline" onClick={onEndSubscription} disabled={isSubPending}
                      className="border-destructive/40 text-destructive hover:bg-destructive/10" data-testid="button-end-subscription">
                      End Now
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* ── Account Monitoring Summary ───────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {[
          {
            label: "Total Calls",
            value: summaryLoading ? "—" : (summary?.totalCalls ?? 0).toLocaleString(),
            icon: <Activity className="h-4 w-4 text-muted-foreground" />,
            sub: summaryLoading ? null : `${(summary?.successCalls ?? 0).toLocaleString()} succeeded`,
          },
          {
            label: "Success Rate",
            value: summaryLoading ? "—" : summary?.totalCalls
              ? `${Math.round(((summary.successCalls) / summary.totalCalls) * 100)}%`
              : "—",
            icon: summary && summary.totalCalls > 0 && summary.failedCalls === 0
              ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              : <XCircle className="h-4 w-4 text-destructive" />,
            sub: summaryLoading ? null : summary?.failedCalls
              ? `${summary.failedCalls.toLocaleString()} failed`
              : "All requests OK",
          },
          {
            label: "Total Spend",
            value: summaryLoading ? "—" : `$${(summary?.totalSpend ?? 0).toFixed(4)}`,
            icon: <TrendingUp className="h-4 w-4 text-muted-foreground" />,
            sub: summaryLoading ? null : `$${(summary?.monthSpend ?? 0).toFixed(4)} this month`,
          },
          {
            label: "Credits Remaining",
            value: summaryLoading ? "—" : (summary?.totalCreditsRemaining ?? 0).toLocaleString(),
            icon: <Zap className="h-4 w-4 text-amber-500" />,
            sub: summaryLoading ? null : `${summary?.activeKeyCount ?? 0} active key(s)`,
          },
        ].map(({ label, value, icon, sub }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">{label}</p>
                {icon}
              </div>
              <p className="text-xl font-bold tracking-tight">{value}</p>
              {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Top Models Used ──────────────────────────────────────── */}
      {!summaryLoading && summary && summary.topModels.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Top Models Used</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex flex-wrap gap-2">
              {summary.topModels.map((m, i) => (
                <div key={m.model} className="flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/20 min-w-0">
                  <span className="text-[10px] font-bold text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-medium truncate max-w-[160px]">{m.model}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {m.calls.toLocaleString()} calls · ${m.spend.toFixed(4)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>API Keys</CardTitle>
              <CardDescription>Manage credentials for this developer.</CardDescription>
            </div>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)} data-testid="button-new-key">
              <Plus className="mr-2 h-4 w-4" /> New Key
            </Button>
          </CardHeader>
          <CardContent>
            {keysLoading ? (
              <div className="text-center py-4 text-muted-foreground text-sm">Loading keys...</div>
            ) : apiKeysData?.items.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No API keys found.</div>
            ) : (
              <div className="space-y-3">
                {apiKeysData?.items.map(apiKey => {
                  const keyPlan = plans?.find((p) => p.id === apiKey.planId);
                  return (
                    <div key={apiKey.id} className="flex items-start justify-between p-3 border rounded-md bg-muted/20" data-testid={`card-apikey-${apiKey.id}`}>
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{apiKey.name || "Unnamed Key"}</span>
                          {!apiKey.isActive || apiKey.revokedAt ? (
                            <Badge variant="secondary" className="text-[10px] shrink-0">Revoked</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 shrink-0">Active</Badge>
                          )}
                          {keyPlan && (
                            <Badge variant="outline" className="text-[10px] shrink-0 gap-1">
                              <ShieldCheck className="h-2.5 w-2.5" />{keyPlan.name}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                          <Key className="h-3 w-3 shrink-0" />
                          <span>{apiKey.keyPrefix}...</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Balance: <span className="font-medium text-foreground">{apiKey.creditBalance.toLocaleString()}</span> credits
                        </div>
                        {keyPlan && keyPlan.modelsAllowed.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {keyPlan.modelsAllowed.slice(0, 4).map((id) => {
                              const m = getModel(id);
                              return (
                                <span key={id} className="text-[9px] bg-muted border rounded px-1 py-0 text-muted-foreground font-mono">
                                  {m?.displayName ?? id}
                                </span>
                              );
                            })}
                            {keyPlan.modelsAllowed.length > 4 && (
                              <span className="text-[9px] text-muted-foreground">+{keyPlan.modelsAllowed.length - 4} more</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {apiKey.isActive && !apiKey.revokedAt && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(apiKey)} data-testid={`button-edit-key-${apiKey.id}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {apiKey.isActive && !apiKey.revokedAt && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleRevoke(apiKey.id)} data-testid={`button-revoke-key-${apiKey.id}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Usage</CardTitle>
            <CardDescription>Latest API calls from this developer.</CardDescription>
          </CardHeader>
          <CardContent>
            {usageLoading ? (
              <div className="text-center py-4 text-muted-foreground text-sm">Loading usage...</div>
            ) : usageData?.items.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No usage recorded yet.</div>
            ) : (
              <div className="space-y-3">
                {usageData?.items.map(log => (
                  <div key={log.id} className="flex items-center justify-between p-3 border rounded-md bg-muted/20">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {log.status === "success" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                        )}
                        <span className="font-medium text-sm">{log.model}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(log.createdAt), "MMM d, HH:mm:ss")}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-medium">{log.totalTokens.toLocaleString()} tokens</div>
                      <div className="text-[10px] text-muted-foreground">${log.costUsd.toFixed(6)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Create API Key dialog ─────────────────────────────── */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          {generatedKey ? (
            <>
              <DialogHeader>
                <DialogTitle>API Key Created</DialogTitle>
                <DialogDescription>The API key has been successfully generated.</DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <div className="p-4 bg-muted rounded-md space-y-2">
                  <Label>API Key</Label>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={generatedKey} className="font-mono bg-background text-xs" data-testid="input-raw-key" />
                    <Button size="icon" variant="outline" onClick={() => copyToClipboard(generatedKey)} data-testid="button-copy-key">
                      {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-destructive font-medium mt-2">
                    Copy this key now — it will not be shown again.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={closeCreateDialog} data-testid="button-done">Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create API Key</DialogTitle>
                <DialogDescription>Generate a new API key for {user.name}.</DialogDescription>
              </DialogHeader>
              <Form {...createForm}>
                <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4 py-4">
                  <FormField control={createForm.control} name="name" render={({ field }) => (
                    <FormItem>
                      <Label>Key Name</Label>
                      <FormControl><Input placeholder="Production Key" {...field} data-testid="input-key-name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={createForm.control} name="planId" render={({ field }) => (
                    <FormItem>
                      <Label>Plan</Label>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-plan">
                            <SelectValue placeholder="Select a plan" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {plans?.map(plan => (
                            <SelectItem key={plan.id} value={plan.id.toString()}>{plan.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <DialogFooter className="mt-2">
                    <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={createApiKey.isPending} data-testid="button-create-key">
                      {createApiKey.isPending ? "Creating..." : "Create Key"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Edit API Key dialog (with model preview) ─────────── */}
      <Dialog open={!!editingKey} onOpenChange={(open) => { if (!open) setEditingKey(null); }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Edit API Key</DialogTitle>
            <DialogDescription>Adjust the plan and credit balance for "{editingKey?.name || "this key"}".</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 py-4">
              <FormField control={editForm.control} name="planId" render={({ field }) => (
                <FormItem>
                  <Label>Plan</Label>
                  <Select
                    onValueChange={(v) => { field.onChange(v); setEditSelectedPlanId(v); }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-edit-plan">
                        <SelectValue placeholder="Select a plan" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {plans?.map(plan => (
                        <SelectItem key={plan.id} value={plan.id.toString()}>
                          <span>{plan.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">${plan.priceUsd}/mo</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Model preview for selected plan */}
                  {editSelectedPlan && (
                    <div className="rounded-md border bg-muted/30 p-2.5 mt-1">
                      <p className="text-xs text-muted-foreground mb-1 font-medium">Allowed models in this plan:</p>
                      <PlanModelBadges modelsAllowed={editSelectedPlan.modelsAllowed} />
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        {editSelectedPlan.rpm} RPM · {editSelectedPlan.monthlyCredits} credits/month
                      </p>
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="creditBalance" render={({ field }) => (
                <FormItem>
                  <Label>Credit Balance</Label>
                  <FormControl>
                    <Input type="number" min={0} step={1} {...field} data-testid="input-credit-balance" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter className="mt-2">
                <Button type="button" variant="outline" onClick={() => setEditingKey(null)}>Cancel</Button>
                <Button type="submit" disabled={updateApiKey.isPending} data-testid="button-save-key">
                  {updateApiKey.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Add Credits dialog ────────────────────────────────── */}
      <Dialog open={addCreditsOpen} onOpenChange={setAddCreditsOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Adjust Top-up Credit</DialogTitle>
            <DialogDescription>
              Top-up credit works on <strong>all models</strong> (including out-of-plan models) and never expires.
              For plan-restricted credit, use "Upgrade Plan" instead.
            </DialogDescription>
          </DialogHeader>
          <Form {...addCreditsForm}>
            <form onSubmit={addCreditsForm.handleSubmit(onAddCreditsSubmit)} className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Adjust <span className="font-medium text-foreground">{user.name || user.email}</span>'s top-up balance. Use a positive number to add, or a negative number to deduct.
              </p>
              <FormField control={addCreditsForm.control} name="amount" render={({ field }) => (
                <FormItem>
                  <Label>{t("admin.credits.amount")}</Label>
                  <FormControl>
                    <Input type="number" step="0.01" placeholder="e.g. 100 or -50" {...field} data-testid="input-credits-amount" />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">Positive = add top-up · Negative = deduct top-up</p>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter className="mt-2">
                <Button type="button" variant="outline" onClick={() => setAddCreditsOpen(false)}>{t("common.cancel")}</Button>
                <Button type="submit" disabled={isAddCreditsPending} data-testid="button-confirm-credits">
                  {isAddCreditsPending ? "Saving..." : (addCreditsForm.watch("amount") < 0 ? "Deduct Credits" : t("admin.credits.addCredits"))}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Upgrade Plan dialog ───────────────────────────────── */}
      <Dialog open={upgradePlanOpen} onOpenChange={(open) => { if (!open) { setUpgradePlanOpen(false); setUpgradeSelectedPlanId(""); } }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Upgrade Plan</DialogTitle>
            <DialogDescription>
              Change the subscription plan for {user.name}. This will update the allowed models and rate limits on their API key(s).
            </DialogDescription>
          </DialogHeader>
          <Form {...upgradePlanForm}>
            <form onSubmit={upgradePlanForm.handleSubmit(onUpgradePlanSubmit)} className="space-y-4 py-2">
              <FormField control={upgradePlanForm.control} name="planId" render={({ field }) => (
                <FormItem>
                  <Label>New Plan</Label>
                  <Select
                    onValueChange={(v) => { field.onChange(v); setUpgradeSelectedPlanId(v); }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-upgrade-plan">
                        <SelectValue placeholder="Select a plan" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {plans?.map(plan => (
                        <SelectItem key={plan.id} value={plan.id.toString()}>
                          <span className="font-medium">{plan.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            ${plan.priceUsd}/mo · {plan.rpm} RPM
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Model preview for upgrade plan */}
                  {upgradeSelectedPlan && (
                    <div className="rounded-md border bg-muted/30 p-2.5 mt-1">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Included models:</p>
                      <PlanModelBadges modelsAllowed={upgradeSelectedPlan.modelsAllowed} />
                      <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
                        <span>{upgradeSelectedPlan.rpm} requests/min</span>
                        <span>·</span>
                        <span>{upgradeSelectedPlan.monthlyCredits} credits/month</span>
                      </div>
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )} />

              {/* Credit top-up notice */}
              {upgradeSelectedPlan && (
                <div className="rounded-md border bg-emerald-500/5 border-emerald-500/20 p-3 space-y-1">
                  <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <Coins className="h-3.5 w-3.5" />
                    Credits will be added automatically
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">+{upgradeSelectedPlan.monthlyCredits.toLocaleString()} credits</span> will be added to the current balance upon upgrade.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    New models and rate limits take effect immediately.
                  </p>
                </div>
              )}

              {activeKeys.length > 1 && (
                <div className="rounded-md border bg-amber-500/5 border-amber-500/20 p-3 text-xs text-amber-600 dark:text-amber-400">
                  This developer has {activeKeys.length} active API keys. The new plan will be applied to all of them.
                </div>
              )}

              <DialogFooter className="mt-2">
                <Button type="button" variant="outline" onClick={() => { setUpgradePlanOpen(false); setUpgradeSelectedPlanId(""); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isUpgradePlanPending || !upgradePlanForm.watch("planId")} data-testid="button-confirm-upgrade">
                  {isUpgradePlanPending ? "Upgrading..." : "Confirm Upgrade"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Revoke API Key Confirmation */}
      <AlertDialog open={revokeKeyId !== null} onOpenChange={(open) => { if (!open) setRevokeKeyId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke this API key? This action cannot be undone and will immediately disable all requests using this key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
