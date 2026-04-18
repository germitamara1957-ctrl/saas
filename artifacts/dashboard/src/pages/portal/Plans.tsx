import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListPortalPlans,
  useGetPortalApiKeys,
  useGetPortalMe,
  getGetPortalApiKeysQueryKey,
  getGetPortalMeQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2, Zap, Image, Video, Text, ArrowUpCircle,
  Crown, AlertCircle, Key, Copy, MessageCircle, Loader2, RefreshCw, Wallet,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MODELS } from "@/lib/models";
import { authFetch } from "@/lib/authFetch";

interface EnrollResult {
  enrolled: boolean;
  existing: boolean;
  keyPrefix: string;
  planName: string;
  creditBalance: number;
  fullKey?: string;
}

const WHATSAPP_NUMBER = "213796586479";

function whatsappUrl(planName: string, priceUsd: number) {
  const msg = encodeURIComponent(
    `Hello, I would like to upgrade my AI Gateway account to the ${planName} plan ($${priceUsd}/mo). Please let me know the next steps. Thank you.`
  );
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`;
}

function ModelChip({ modelId }: { modelId: string }) {
  const model = MODELS.find(m => m.id === modelId);
  const label = model?.displayName ?? modelId;
  const cat = model?.category ?? "text";
  const icons: Record<string, React.ReactNode> = {
    text: <Text className="h-3 w-3" />,
    image: <Image className="h-3 w-3" />,
    video: <Video className="h-3 w-3" />,
  };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted border">
      {icons[cat]} {label}
    </span>
  );
}

const PLAN_ICONS = [
  <Zap className="h-4 w-4" />,
  <Crown className="h-4 w-4" />,
  <ArrowUpCircle className="h-4 w-4" />,
];

export default function PortalPlans() {
  const queryClient = useQueryClient();
  const { data: plans, isLoading, isError } = useListPortalPlans();
  const { data: apiKeys, isLoading: keysLoading, isError: keysError } = useGetPortalApiKeys();
  const { data: meData, refetch: refetchMe } = useGetPortalMe();
  const { toast } = useToast();

  const [enrollingPlanId, setEnrollingPlanId] = useState<number | null>(null);
  const [newKeyInfo, setNewKeyInfo] = useState<EnrollResult | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [chargilyEnabled, setChargilyEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authFetch("/api/portal/billing/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => { if (!cancelled && cfg) setChargilyEnabled(Boolean(cfg.enabled)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const activePlans = (plans ?? []).filter(p => p.isActive).sort((a, b) => a.priceUsd - b.priceUsd);

  const currentPlanIdFromMe = meData?.user?.currentPlanId ?? null;
  const apiKeyPlanIds = new Set(
    (apiKeys ?? []).filter(k => k.isActive && k.planId != null).map(k => k.planId as number)
  );
  const myPlanId = currentPlanIdFromMe ?? (apiKeyPlanIds.size > 0 ? [...apiKeyPlanIds][0] : null);

  const myPlan = activePlans.find(p => p.id === myPlanId);
  const myPlanIndex = myPlan ? activePlans.indexOf(myPlan) : -1;

  const enrollMutation = useMutation({
    mutationFn: async (planId: number): Promise<EnrollResult> => {
      const res = await authFetch(`/api/portal/plans/${planId}/enroll`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enrollment failed");
      return data as EnrollResult;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: getGetPortalApiKeysQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPortalMeQueryKey() });
      if (result.existing) {
        // Plan assigned to existing key — no need to reveal key again
        toast({
          title: `✅ ${result.planName} plan activated!`,
          description: `Your existing API key (${result.keyPrefix}…) now has $${result.creditBalance} in credits.`,
        });
      } else {
        // New key was created — show the full key
        setNewKeyInfo(result);
      }
    },
    onError: (e: Error) => {
      toast({ title: "Enrollment failed", description: e.message, variant: "destructive" });
    },
    onSettled: () => setEnrollingPlanId(null),
  });

  const handleEnrollFree = (planId: number) => {
    setEnrollingPlanId(planId);
    enrollMutation.mutate(planId);
  };

  const copyNewKey = () => {
    if (!newKeyInfo?.fullKey) return;
    navigator.clipboard.writeText(newKeyInfo.fullKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
    toast({ title: "API key copied — store it safely!" });
  };

  if (isLoading || keysLoading || isError || keysError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Plans</h1>
          <p className="text-muted-foreground mt-1">Available subscription plans and their included models.</p>
        </div>
        {isError || keysError ? (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            Failed to load plans. Please refresh the page.
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Loading plans...</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Plans</h1>
        <p className="text-muted-foreground mt-1">Available subscription plans and their included models.</p>
      </div>

      {/* Current plan banner */}
      {myPlan ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-center gap-3">
          <div className="bg-primary/10 rounded-full p-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-sm">
              You are on the <span className="text-primary">{myPlan.name}</span> plan
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              ${myPlan.monthlyCredits} monthly credits · {myPlan.rpm} RPM · {myPlan.modelsAllowed.length} models
            </p>
          </div>
          {myPlanIndex < activePlans.length - 1 && (
            <Badge variant="outline" className="text-xs shrink-0 border-primary/30 text-primary">
              Upgrade available
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Refresh plan info"
            onClick={() => { queryClient.invalidateQueries({ queryKey: getGetPortalMeQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetPortalApiKeysQueryKey() }); refetchMe(); }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex items-center gap-3">
          <div className="bg-amber-500/10 rounded-full p-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-sm text-amber-600">No active plan</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Start with the Free plan instantly, or contact us to subscribe to a paid plan.
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Refresh plan info"
            onClick={() => { queryClient.invalidateQueries({ queryKey: getGetPortalMeQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetPortalApiKeysQueryKey() }); refetchMe(); }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="shrink-0 gap-1.5" asChild>
            <a href="/portal/api-keys">
              <Key className="h-3.5 w-3.5" /> View Keys
            </a>
          </Button>
        </div>
      )}

      {/* Plan cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {activePlans.map((plan, idx) => {
          const isMyPlan = plan.id === myPlanId;
          const isUpgrade = myPlanIndex >= 0 && idx > myPlanIndex;
          const isDowngrade = myPlanIndex >= 0 && idx < myPlanIndex;
          const isFree = plan.priceUsd === 0;
          const isEnrolling = enrollingPlanId === plan.id;
          const models: string[] = plan.modelsAllowed;
          const textModels = models.filter(id => MODELS.find(m => m.id === id)?.category === "text");
          const imageModels = models.filter(id => MODELS.find(m => m.id === id)?.category === "image");
          const videoModels = models.filter(id => MODELS.find(m => m.id === id)?.category === "video");

          return (
            <Card
              key={plan.id}
              className={`flex flex-col relative transition-all ${
                isMyPlan
                  ? "border-primary shadow-md ring-1 ring-primary/20"
                  : isUpgrade || (!myPlan && !isFree)
                  ? "border-dashed hover:border-primary/40 hover:shadow-sm"
                  : isDowngrade
                  ? "opacity-60"
                  : ""
              }`}
            >
              {/* Badge */}
              {isMyPlan && (
                <div className="absolute -top-3 left-4">
                  <div className="bg-primary text-primary-foreground text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                    <CheckCircle2 className="h-3 w-3" /> Your Current Plan
                  </div>
                </div>
              )}
              {(isUpgrade || (!myPlan && !isFree)) && !isMyPlan && (
                <div className="absolute -top-3 left-4">
                  <div className="bg-muted text-muted-foreground border text-[11px] font-medium px-2.5 py-1 rounded-full flex items-center gap-1.5">
                    <ArrowUpCircle className="h-3 w-3" /> Upgrade
                  </div>
                </div>
              )}

              <CardHeader className="pb-2 pt-6">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl">
                    <span className={isMyPlan ? "text-primary" : ""}>{plan.name}</span>
                  </CardTitle>
                  <span className={`p-1.5 rounded-md ${isMyPlan ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {PLAN_ICONS[idx % PLAN_ICONS.length]}
                  </span>
                </div>
                {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
              </CardHeader>

              <CardContent className="flex-1 flex flex-col gap-4">
                {/* Price */}
                <div className="flex items-end gap-1">
                  <span className={`text-4xl font-bold ${isMyPlan ? "text-primary" : ""}`}>
                    {isFree ? "Free" : `$${plan.priceUsd}`}
                  </span>
                  {!isFree && <span className="text-muted-foreground mb-1 text-sm">/mo</span>}
                </div>

                {/* Stats */}
                <div className="space-y-2 text-sm border rounded-lg p-3 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      Monthly Credits
                      <span className="text-[10px] bg-muted border rounded px-1 py-0.5 font-mono text-muted-foreground/70">USD</span>
                    </span>
                    <span className="font-mono font-medium">${plan.monthlyCredits.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Zap className="h-3 w-3" /> Rate Limit
                    </span>
                    <span className="font-mono font-medium">{plan.rpm} RPM</span>
                  </div>
                </div>

                {/* Models */}
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-medium">Allowed Models</p>
                  {textModels.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Text className="h-3 w-3" /> Text</p>
                      <div className="flex flex-wrap gap-1">{textModels.map(id => <ModelChip key={id} modelId={id} />)}</div>
                    </div>
                  )}
                  {imageModels.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Image className="h-3 w-3" /> Image</p>
                      <div className="flex flex-wrap gap-1">{imageModels.map(id => <ModelChip key={id} modelId={id} />)}</div>
                    </div>
                  )}
                  {videoModels.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Video className="h-3 w-3" /> Video</p>
                      <div className="flex flex-wrap gap-1">{videoModels.map(id => <ModelChip key={id} modelId={id} />)}</div>
                    </div>
                  )}
                </div>

                {/* CTA */}
                <div className="pt-1 space-y-2">
                  {isMyPlan ? (
                    <Button className="w-full" disabled>
                      <CheckCircle2 className="h-4 w-4 mr-2" /> Active Plan
                    </Button>
                  ) : isDowngrade ? (
                    <Button className="w-full" variant="ghost" disabled>Lower Tier</Button>
                  ) : isFree ? (
                    /* Free plan → auto-enroll instantly */
                    <Button
                      className="w-full"
                      onClick={() => handleEnrollFree(plan.id)}
                      disabled={isEnrolling}
                    >
                      {isEnrolling
                        ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Activating...</>
                        : <><Zap className="h-4 w-4 mr-2" /> Start Free Now</>
                      }
                    </Button>
                  ) : (
                    /* Paid plans → Chargily Top up (if enabled) + WhatsApp */
                    <>
                      {chargilyEnabled && (
                        <Button className="w-full" asChild>
                          <Link href="/portal/billing">
                            <Wallet className="h-4 w-4 mr-2" /> Top up Credits (DZD)
                          </Link>
                        </Button>
                      )}
                      <Button
                        className="w-full bg-[#25D366] hover:bg-[#1ebe5d] text-white border-0"
                        variant={chargilyEnabled ? "outline" : "default"}
                        asChild
                      >
                        <a href={whatsappUrl(plan.name, plan.priceUsd)} target="_blank" rel="noopener noreferrer">
                          <MessageCircle className="h-4 w-4 mr-2" /> Contact via WhatsApp
                        </a>
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground flex items-center gap-2">
        <MessageCircle className="h-4 w-4 shrink-0 text-[#25D366]" />
        <p>For paid plan subscriptions, use the WhatsApp button on the plan card to reach us directly.</p>
      </div>

      {/* New key reveal dialog — only shown when a brand new key was created */}
      <AlertDialog open={!!newKeyInfo && !!newKeyInfo.fullKey} onOpenChange={(open) => { if (!open) setNewKeyInfo(null); }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-500">
              <CheckCircle2 className="h-5 w-5" />
              {newKeyInfo?.planName} Plan Activated!
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your account is now on the <strong>{newKeyInfo?.planName}</strong> plan with{" "}
              <strong>${newKeyInfo?.creditBalance}</strong> in credits. Copy your API key now — it will not be shown again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2.5 bg-muted rounded-md text-xs font-mono break-all border border-primary/20 select-all">
                {newKeyInfo?.fullKey}
              </code>
              <Button variant="outline" size="icon" onClick={copyNewKey}>
                {keyCopied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Store this key safely. You won't be able to see the full key again.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setNewKeyInfo(null)}>I've saved my key — Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
