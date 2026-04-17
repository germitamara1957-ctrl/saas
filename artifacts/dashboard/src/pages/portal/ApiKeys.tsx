import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetPortalApiKeys, useListPortalPlans, useCreatePortalApiKey, getGetPortalApiKeysQueryKey, type CreatePortalApiKeyResult } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Copy, Eye, EyeOff, CheckCircle2, Star, Key, Plus, ShieldCheck, Trash2, FileText, ArchiveX, SlidersHorizontal, RefreshCw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authFetch";

import { maskKey } from "@/lib/constants";

export default function PortalApiKeys() {
  const { data: apiKeys, isLoading } = useGetPortalApiKeys();
  const queryClient = useQueryClient();
  const { data: plans } = useListPortalPlans();
  const createKey = useCreatePortalApiKey();
  const { toast } = useToast();

  const [copiedMap, setCopiedMap] = useState<Record<number, boolean>>({});
  const [revealedMap, setRevealedMap] = useState<Record<number, boolean>>({});
  const [revealedKeysMap, setRevealedKeysMap] = useState<Record<number, string>>({});
  const [revealingMap, setRevealingMap] = useState<Record<number, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<CreatePortalApiKeyResult | null>(null);
  const [newKeyCopied, setNewKeyCopied] = useState(false);
  const [deleteKeyId, setDeleteKeyId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const [limitsKey, setLimitsKey] = useState<{ id: number; name: string; rpmLimit: number | null; monthlySpendLimitUsd: number | null } | null>(null);
  const [limitsRpm, setLimitsRpm] = useState<string>("");
  const [limitsSpend, setLimitsSpend] = useState<string>("");
  const [savingLimits, setSavingLimits] = useState(false);
  const [rotateKeyId, setRotateKeyId] = useState<number | null>(null);
  const [rotatingId, setRotatingId] = useState<number | null>(null);
  const [rotatedKey, setRotatedKey] = useState<{ fullKey: string; oldKeyExpiresAt: string } | null>(null);
  const [rotatedKeyCopied, setRotatedKeyCopied] = useState(false);

  const rotateMutation = useMutation({
    mutationFn: async (keyId: number) => {
      const res = await authFetch(`/api/portal/api-keys/${keyId}/rotate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to rotate key");
      return data as { fullKey: string; oldKeyExpiresAt: string };
    },
    onSuccess: (data) => {
      setRotatedKey({ fullKey: data.fullKey, oldKeyExpiresAt: data.oldKeyExpiresAt });
      queryClient.invalidateQueries({ queryKey: getGetPortalApiKeysQueryKey() });
      toast({ title: "Key rotated", description: "Old key keeps working for 24 hours so you can migrate clients." });
    },
    onError: (e: Error) => toast({ title: "Failed to rotate key", description: e.message, variant: "destructive" }),
    onSettled: () => { setRotatingId(null); setRotateKeyId(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (keyId: number) => {
      const res = await authFetch(`/api/portal/api-keys/${keyId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete key");
      return data;
    },
    onSuccess: () => {
      toast({ title: "API key revoked successfully" });
      queryClient.invalidateQueries({ queryKey: getGetPortalApiKeysQueryKey() });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to revoke key", description: e.message, variant: "destructive" });
    },
    onSettled: () => {
      setDeletingId(null);
      setDeleteKeyId(null);
    },
  });

  const handleDelete = () => {
    if (!deleteKeyId) return;
    setDeletingId(deleteKeyId);
    deleteMutation.mutate(deleteKeyId);
  };

  const copyToClipboard = (text: string, id: number) => {
    navigator.clipboard.writeText(text);
    setCopiedMap(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setCopiedMap(prev => ({ ...prev, [id]: false })), 2000);
    toast({ title: "API key copied to clipboard" });
  };

  const toggleReveal = async (id: number) => {
    const isCurrentlyRevealed = revealedMap[id];
    if (isCurrentlyRevealed) {
      setRevealedMap(prev => ({ ...prev, [id]: false }));
      return;
    }
    if (revealedKeysMap[id]) {
      setRevealedMap(prev => ({ ...prev, [id]: true }));
      return;
    }
    setRevealingMap(prev => ({ ...prev, [id]: true }));
    try {
      const res = await authFetch(`/api/portal/api-keys/${id}/reveal`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to reveal key");
      setRevealedKeysMap(prev => ({ ...prev, [id]: data.fullKey }));
      setRevealedMap(prev => ({ ...prev, [id]: true }));
    } catch (e: unknown) {
      toast({ title: "Could not reveal key", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setRevealingMap(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleCreate = () => {
    createKey.mutate(
      { data: { name: keyName.trim() || undefined } },
      {
        onSuccess: (result) => {
          setNewKey(result);
          setCreateOpen(false);
          setKeyName("");
          queryClient.invalidateQueries({ queryKey: getGetPortalApiKeysQueryKey() });
        },
        onError: (e: Error) => toast({ title: "Failed to create key", description: e.message, variant: "destructive" }),
      }
    );
  };

  const copyNewKey = () => {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey.fullKey);
    setNewKeyCopied(true);
    setTimeout(() => setNewKeyCopied(false), 2000);
    toast({ title: "API key copied — store it safely!" });
  };

  const revokedKeys = apiKeys?.filter(k => !k.isActive) ?? [];
  const activeKeys = apiKeys?.filter(k => k.isActive) ?? [];
  const visibleKeys = showRevoked ? (apiKeys ?? []) : activeKeys;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground mt-1">Keys for authenticating requests to the gateway.</p>
        </div>
        <div className="flex items-center gap-2">
          {revokedKeys.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRevoked(v => !v)}
              className={showRevoked ? "border-muted-foreground/40 text-muted-foreground" : ""}
            >
              <ArchiveX className="h-4 w-4 mr-1.5" />
              {showRevoked ? "Hide Revoked" : `Show Revoked (${revokedKeys.length})`}
            </Button>
          )}
          <Button onClick={() => { setKeyName(""); setTermsAccepted(false); setCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Create API Key
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading keys...</div>
      ) : !apiKeys || apiKeys.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="bg-muted rounded-full p-4">
              <Key className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium">No API keys yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create your first key to start making API calls.</p>
            </div>
            <Button onClick={() => { setKeyName(""); setTermsAccepted(false); setCreateOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Create API Key
            </Button>
          </CardContent>
        </Card>
      ) : visibleKeys.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="bg-muted rounded-full p-4">
              <Key className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium">No active keys</p>
              <p className="text-sm text-muted-foreground mt-1">All your keys have been revoked. Create a new one to get started.</p>
            </div>
            <Button onClick={() => { setKeyName(""); setTermsAccepted(false); setCreateOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Create API Key
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {visibleKeys.map(key => {
            const plan = plans?.find(p => p.id === key.planId);
            return (
              <Card key={key.id} className={!key.isActive ? "opacity-60" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <CardTitle className="text-base truncate">{key.name || "Unnamed Key"}</CardTitle>
                      {key.isActive ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] shrink-0">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] shrink-0">Revoked</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {plan && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Star className="h-3 w-3 text-amber-500" />
                          <span className="font-medium">{plan.name}</span>
                        </div>
                      )}
                      {key.isActive && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => setLimitsKey({ id: key.id, name: key.name ?? "", rpmLimit: (key as { rpmLimit?: number | null }).rpmLimit ?? null, monthlySpendLimitUsd: (key as { monthlySpendLimitUsd?: number | null }).monthlySpendLimitUsd ?? null })}
                            title="Edit per-key limits"
                          >
                            <SlidersHorizontal className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => setRotateKeyId(key.id)}
                            disabled={rotatingId === key.id}
                            title="Rotate key (issue a new key, old key valid 24h)"
                          >
                            <RefreshCw className={`h-4 w-4 ${rotatingId === key.id ? "animate-spin" : ""}`} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteKeyId(key.id)}
                            disabled={deletingId === key.id}
                            title="Revoke key"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <CardDescription className="text-xs">
                    Created {new Date(key.createdAt).toLocaleDateString()} · Last used: {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Never"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Key</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-muted rounded-md text-xs font-mono text-muted-foreground overflow-hidden break-all">
                        {revealedMap[key.id] && revealedKeysMap[key.id]
                          ? revealedKeysMap[key.id]
                          : maskKey(undefined, key.keyPrefix, false)}
                      </code>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => toggleReveal(key.id)}
                        title={revealedMap[key.id] ? "Hide key" : "Reveal full key"}
                        disabled={revealingMap[key.id]}
                      >
                        {revealingMap[key.id]
                          ? <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin block" />
                          : revealedMap[key.id]
                            ? <EyeOff className="h-4 w-4" />
                            : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(revealedKeysMap[key.id] ?? key.keyPrefix, key.id)}
                        title="Copy"
                      >
                        {copiedMap[key.id] ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-1">
                    <div className="rounded-lg bg-muted/50 border p-3 text-center">
                      <p className="text-lg font-bold">${key.creditBalance.toLocaleString()}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Credit Balance (USD)</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 border p-3 text-center">
                      <p className="text-lg font-bold">{plan?.rpm ?? "—"}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Rate Limit (RPM)</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 border p-3 text-center">
                      <p className={`text-lg font-bold ${key.isActive ? "text-emerald-500" : "text-muted-foreground"}`}>
                        {key.isActive ? "Active" : "Revoked"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Status</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Key Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>Give your key a name to identify it later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Key Name (optional)</Label>
              <Input
                placeholder="e.g. Production, My App, Testing..."
                value={keyName}
                onChange={e => setKeyName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && termsAccepted && handleCreate()}
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
              Your key is stored securely. You can reveal it anytime from the dashboard.
            </p>

            {/* Acceptable Use Policy Agreement */}
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-amber-600">Acceptable Use Policy</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    By creating this key you agree that:
                  </p>
                  <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc list-inside leading-relaxed">
                    <li>You will not use this API to generate malware, illegal content, or harmful material.</li>
                    <li>You will not attempt to bypass safety filters or misuse the service.</li>
                    <li>Policy violations are <strong>logged and retained</strong> as evidence for accountability.</li>
                    <li>After <strong>3 violations</strong>, your account will be <strong>permanently suspended</strong>.</li>
                    <li><strong>No refunds</strong> will be issued for suspended accounts under any circumstances.</li>
                  </ul>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-amber-500/20">
                <Checkbox
                  id="terms"
                  checked={termsAccepted}
                  onCheckedChange={(v) => setTermsAccepted(!!v)}
                />
                <label htmlFor="terms" className="text-xs font-medium cursor-pointer select-none">
                  I have read and agree to the Acceptable Use Policy
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createKey.isPending || !termsAccepted}>
              {createKey.isPending ? "Creating..." : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteKeyId} onOpenChange={open => { if (!open) setDeleteKeyId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> Revoke API Key?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently deactivate the key. Any application using it will stop working immediately.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Revoking..." : "Yes, Revoke Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New Key Reveal Dialog */}
      <AlertDialog open={!!newKey} onOpenChange={open => { if (!open) setNewKey(null); }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-500">
              <CheckCircle2 className="h-5 w-5" /> API Key Created
            </AlertDialogTitle>
            <AlertDialogDescription>
              Copy your full API key now — it will not be shown again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-muted rounded-md text-xs font-mono break-all border border-primary/20">
                {newKey?.fullKey}
              </code>
              <Button variant="outline" size="icon" onClick={copyNewKey}>
                {newKeyCopied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
              You can reveal this key anytime from the API Keys dashboard using the eye icon.
            </p>
            {!newKey?.creditBalance && (
              <p className="text-xs text-muted-foreground">
                Your key starts with $0 credits. Contact your administrator to add credits and assign a plan.
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setNewKey(null)}>I've saved my key</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!limitsKey} onOpenChange={(o) => { if (!o) setLimitsKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Per-Key Limits</DialogTitle>
            <DialogDescription>
              Override your plan's rate limit and set a monthly spend cap for "{limitsKey?.name || "this key"}". Leave blank to use plan defaults.
            </DialogDescription>
          </DialogHeader>
          {limitsKey && (
            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="rpm-limit">Requests per minute (RPM)</Label>
                <Input
                  id="rpm-limit"
                  type="number"
                  min="1"
                  placeholder={`Plan default`}
                  defaultValue={limitsKey.rpmLimit ?? ""}
                  onChange={(e) => setLimitsRpm(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="spend-limit">Monthly spend cap (USD)</Label>
                <Input
                  id="spend-limit"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="No cap"
                  defaultValue={limitsKey.monthlySpendLimitUsd ?? ""}
                  onChange={(e) => setLimitsSpend(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLimitsKey(null)}>Cancel</Button>
            <Button
              disabled={savingLimits}
              onClick={async () => {
                if (!limitsKey) return;
                setSavingLimits(true);
                try {
                  const rpmRaw = limitsRpm !== "" ? limitsRpm : (limitsKey.rpmLimit?.toString() ?? "");
                  const spendRaw = limitsSpend !== "" ? limitsSpend : (limitsKey.monthlySpendLimitUsd?.toString() ?? "");
                  const body: Record<string, unknown> = {
                    rpmLimit: rpmRaw === "" ? null : Number(rpmRaw),
                    monthlySpendLimitUsd: spendRaw === "" ? null : Number(spendRaw),
                  };
                  const res = await authFetch(`/api/portal/api-keys/${limitsKey.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error ?? "Failed to update limits");
                  toast({ title: "Limits updated" });
                  await queryClient.invalidateQueries({ queryKey: getGetPortalApiKeysQueryKey() });
                  setLimitsKey(null);
                  setLimitsRpm("");
                  setLimitsSpend("");
                } catch (err) {
                  toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
                } finally {
                  setSavingLimits(false);
                }
              }}
            >
              {savingLimits ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={rotateKeyId !== null} onOpenChange={(o) => !o && setRotateKeyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate this API key?</AlertDialogTitle>
            <AlertDialogDescription>
              We'll issue a brand new key and grant the current one a 24-hour grace window so you can update your clients without downtime. After 24 hours the old key stops working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotatingId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (rotateKeyId === null) return;
                setRotatingId(rotateKeyId);
                rotateMutation.mutate(rotateKeyId);
              }}
              disabled={rotatingId !== null}
            >
              {rotatingId !== null ? "Rotating..." : "Rotate Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={rotatedKey !== null} onOpenChange={(o) => { if (!o) { setRotatedKey(null); setRotatedKeyCopied(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>
              This is the only time we'll show the full key — copy it now and store it somewhere safe. The old key continues to work until {rotatedKey ? new Date(rotatedKey.oldKeyExpiresAt).toLocaleString() : ""}.
            </DialogDescription>
          </DialogHeader>
          {rotatedKey && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-muted rounded-md text-xs font-mono break-all">{rotatedKey.fullKey}</code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(rotatedKey.fullKey);
                    setRotatedKeyCopied(true);
                    setTimeout(() => setRotatedKeyCopied(false), 2000);
                    toast({ title: "Copied — store it safely!" });
                  }}
                >
                  {rotatedKeyCopied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => { setRotatedKey(null); setRotatedKeyCopied(false); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
