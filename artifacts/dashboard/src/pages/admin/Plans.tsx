import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useListPlans, useCreatePlan, useUpdatePlan, getListPlansQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Plus, Zap, Image, Video, Text, ExternalLink, Check, Pencil, Search } from "lucide-react";
import type { Plan } from "@workspace/api-client-react";
import { MODELS, PROVIDER_META, ALL_PROVIDERS, getModel, ModelDef, ModelProvider } from "@/lib/models";

const planSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  monthlyCredits: z.coerce.number().min(0),
  rpm: z.coerce.number().min(0),
  maxApiKeys: z.coerce.number().min(1).default(3),
  maxWebhooks: z.coerce.number().min(0).default(3),
  modelsAllowed: z.string().min(1),
  priceUsd: z.coerce.number().min(0),
});

const categoryIcon = {
  text: <Text className="h-3.5 w-3.5" />,
  image: <Image className="h-3.5 w-3.5" />,
  video: <Video className="h-3.5 w-3.5" />,
  embedding: <Zap className="h-3.5 w-3.5" />,
};

const categoryColor = {
  text: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  image: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  video: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  embedding: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
};

function ModelBadge({ modelId }: { modelId: string }) {
  const def = getModel(modelId);
  if (!def) return <Badge variant="secondary" className="text-xs font-mono">{modelId}</Badge>;
  const cat = def.category;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${def.comingSoon ? "opacity-50" : ""} ${categoryColor[cat]}`}>
      {categoryIcon[cat]}
      {def.displayName}
      {def.isNew && !def.comingSoon && <span className="ml-0.5 text-[10px] font-bold uppercase opacity-70">New</span>}
      {def.comingSoon && <span className="ml-0.5 text-[10px] font-bold uppercase opacity-80">Soon</span>}
    </span>
  );
}

function ModelPricingRow({ model }: { model: ModelDef }) {
  const { t } = useTranslation();
  const p = model.pricing;
  return (
    <div className={`flex items-center justify-between py-2 border-b last:border-0 ${model.comingSoon ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${categoryColor[model.category]}`}>
          {categoryIcon[model.category]}
          {model.displayName}
          {model.isNew && !model.comingSoon && <span className="ml-0.5 text-[10px] font-bold uppercase opacity-60">New</span>}
          {model.comingSoon && <span className="ml-0.5 text-[10px] font-bold uppercase opacity-80">Soon</span>}
        </span>
      </div>
      <div className="text-right text-xs text-muted-foreground font-mono">
        {p.inputPer1MTokens !== undefined && (
          <div>
            <span className="text-foreground font-medium">${p.inputPer1MTokens}</span> {t("models.pricingInput")} · <span className="text-foreground font-medium">${p.outputPer1MTokens}</span> {t("models.pricingOutput")}
            <span className="opacity-60"> / 1M</span>
          </div>
        )}
        {p.thinkingPer1MTokens !== undefined && (
          <div className="opacity-70">${p.thinkingPer1MTokens} {t("models.pricingThinking")} / 1M</div>
        )}
        {p.perImage !== undefined && <div><span className="text-foreground font-medium">${p.perImage}</span> {t("models.pricingPerImage")}</div>}
        {p.perSecond !== undefined && <div><span className="text-foreground font-medium">${p.perSecond}</span> {t("models.pricingPerSecond")}</div>}
      </div>
    </div>
  );
}

// ─── ModelPicker ─────────────────────────────────────────────────────────────
function ModelPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [search, setSearch] = useState("");

  const selected = useMemo(
    () => new Set(value.split(",").map((s) => s.trim()).filter(Boolean)),
    [value],
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange([...next].join(","));
  };

  const toggleProvider = (provider: ModelProvider) => {
    const providerIds = MODELS.filter((m) => m.provider === provider).map((m) => m.id);
    const allSelected = providerIds.every((id) => selected.has(id));
    const next = new Set(selected);
    if (allSelected) providerIds.forEach((id) => next.delete(id));
    else providerIds.forEach((id) => next.add(id));
    onChange([...next].join(","));
  };

  const q = search.toLowerCase();
  const filteredProviders = ALL_PROVIDERS.filter((provider) =>
    MODELS.some(
      (m) => m.provider === provider && (
        !q || m.displayName.toLowerCase().includes(q) || PROVIDER_META[provider].label.toLowerCase().includes(q)
      )
    )
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search models or providers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>
      <ScrollArea className="h-80 rounded-lg border bg-muted/20">
        <div className="p-3 space-y-4">
          {filteredProviders.map((provider) => {
            const meta = PROVIDER_META[provider];
            const providerModels = MODELS.filter(
              (m) => m.provider === provider && (!q || m.displayName.toLowerCase().includes(q) || meta.label.toLowerCase().includes(q))
            );
            if (providerModels.length === 0) return null;
            const allSel = providerModels.every((m) => selected.has(m.id));
            const someSel = providerModels.some((m) => selected.has(m.id));
            return (
              <div key={provider}>
                {/* Provider header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
                    <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
                    <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
                      {providerModels.filter((m) => selected.has(m.id)).length}/{providerModels.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleProvider(provider)}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                      allSel
                        ? `${meta.bg} ${meta.color} ${meta.border}`
                        : "text-muted-foreground border-border hover:border-primary/40"
                    }`}
                  >
                    {allSel ? "Deselect all" : someSel ? "Select rest" : "Select all"}
                  </button>
                </div>
                {/* Model cards grid */}
                <div className="grid grid-cols-2 gap-1.5">
                  {providerModels.map((m) => {
                    const active = selected.has(m.id);
                    const isDisabled = m.comingSoon === true;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => !isDisabled && toggle(m.id)}
                        disabled={isDisabled}
                        className={`group relative text-left rounded-lg border px-3 py-2 transition-all ${
                          isDisabled
                            ? "opacity-45 cursor-not-allowed bg-muted/30 border-border"
                            : active
                            ? `${meta.bg} ${meta.border} ring-1 ring-inset ${meta.border}`
                            : "bg-background border-border hover:border-primary/40 hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-xs font-medium leading-tight ${active && !isDisabled ? meta.color : "text-foreground"}`}>
                                {m.displayName}
                              </span>
                              {m.isNew && !isDisabled && (
                                <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-primary/10 text-primary leading-none">
                                  New
                                </span>
                              )}
                              {m.isPreview && !isDisabled && (
                                <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 leading-none">
                                  Preview
                                </span>
                              )}
                              {isDisabled && (
                                <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-muted text-muted-foreground leading-none">
                                  Soon
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 font-mono leading-tight">
                              {m.pricing.inputPer1MTokens !== undefined
                                ? `$${m.pricing.inputPer1MTokens}/$${m.pricing.outputPer1MTokens} /1M`
                                : m.pricing.perImage !== undefined
                                ? `$${m.pricing.perImage}/img`
                                : `$${m.pricing.perSecond}/sec`}
                            </div>
                          </div>
                          {!isDisabled && (
                            <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded flex items-center justify-center border transition-all ${
                              active ? `${meta.dot} border-transparent` : "border-border bg-background"
                            }`}>
                              {active && <Check className="h-2.5 w-2.5 text-white" />}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filteredProviders.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">No models match your search.</div>
          )}
        </div>
      </ScrollArea>
      <div className="text-xs text-muted-foreground">
        {selected.size} model{selected.size !== 1 ? "s" : ""} selected
      </div>
    </div>
  );
}

export default function AdminPlans() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const { toast } = useToast();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: plans, isLoading, isError } = useListPlans();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();

  const form = useForm<z.infer<typeof planSchema>>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      name: "",
      description: "",
      monthlyCredits: 1000,
      rpm: 60,
      maxApiKeys: 3,
      maxWebhooks: 3,
      modelsAllowed: "gemini-3.0-flash-preview,gemini-3.1-pro-preview",
      priceUsd: 0,
    },
  });

  const editForm = useForm<z.infer<typeof planSchema>>({
    resolver: zodResolver(planSchema),
    defaultValues: { name: "", description: "", monthlyCredits: 1000, rpm: 60, maxApiKeys: 3, maxWebhooks: 3, modelsAllowed: "", priceUsd: 0 },
  });

  const openEditDialog = (plan: Plan) => {
    setEditingPlan(plan);
    editForm.reset({
      name: plan.name,
      description: plan.description ?? "",
      monthlyCredits: plan.monthlyCredits,
      rpm: plan.rpm,
      maxApiKeys: (plan as Plan & { maxApiKeys?: number }).maxApiKeys ?? 3,
      modelsAllowed: plan.modelsAllowed.join(","),
      priceUsd: plan.priceUsd,
    });
  };

  const onEditSubmit = (data: z.infer<typeof planSchema>) => {
    if (!editingPlan) return;
    updatePlan.mutate(
      {
        id: editingPlan.id,
        data: {
          ...data,
          modelsAllowed: data.modelsAllowed.split(",").map((s) => s.trim()).filter(Boolean),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPlansQueryKey() });
          setEditingPlan(null);
          toast({ title: t("common.success") });
        },
        onError: (err) => {
          toast({ title: t("common.error"), description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const onSubmit = (data: z.infer<typeof planSchema>) => {
    createPlan.mutate(
      {
        data: {
          ...data,
          modelsAllowed: data.modelsAllowed.split(",").map((s) => s.trim()).filter(Boolean),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPlansQueryKey() });
          setCreateDialogOpen(false);
          form.reset();
          toast({ title: t("common.success") });
        },
        onError: (err) => {
          toast({ title: t("common.error"), description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const togglePlanStatus = (plan: Plan) => {
    updatePlan.mutate(
      { id: plan.id, data: { isActive: !plan.isActive } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPlansQueryKey() });
          toast({ title: `Plan ${!plan.isActive ? "activated" : "deactivated"}` });
        },
      }
    );
  };

  // Group plan models by category
  const groupedModels = (modelIds: string[]) => {
    const text = modelIds.filter((id) => getModel(id)?.category === "text");
    const image = modelIds.filter((id) => getModel(id)?.category === "image");
    const video = modelIds.filter((id) => getModel(id)?.category === "video");
    return { text, image, video };
  };

  const textModels = MODELS.filter((m) => m.category === "text");
  const imageModels = MODELS.filter((m) => m.category === "image");
  const videoModels = MODELS.filter((m) => m.category === "video");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("admin.plans.title")}</h1>
        <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-plan">
          <Plus className="mr-2 h-4 w-4" /> {t("admin.plans.createPlan")}
        </Button>
      </div>

      {/* Plans grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <div className="col-span-3 text-center py-12 text-muted-foreground">{t("common.loading")}</div>
        ) : isError ? (
          <div className="col-span-3 text-center py-12 text-destructive">Failed to load plans. Please refresh the page.</div>
        ) : plans?.length === 0 ? (
          <div className="col-span-3 text-center py-12 text-muted-foreground">{t("admin.plans.noPlans")}</div>
        ) : (
          plans?.map((plan) => {
            const grouped = groupedModels(plan.modelsAllowed);
            return (
              <Card
                key={plan.id}
                className={`flex flex-col transition-all ${!plan.isActive ? "opacity-60" : "shadow-sm"}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-xl">{plan.name}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-0.5">{plan.description}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(plan)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Switch
                        checked={plan.isActive}
                        onCheckedChange={() => togglePlanStatus(plan)}
                        aria-label="Toggle plan"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  {/* Price */}
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-bold">
                      {plan.priceUsd === 0 ? t("admin.plans.free") : `$${plan.priceUsd}`}
                    </span>
                    {plan.priceUsd > 0 && (
                      <span className="text-muted-foreground mb-1 text-sm">{t("admin.plans.perMonth")}</span>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="space-y-2 text-sm border rounded-lg p-3 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-1">
                        {t("admin.plans.monthlyCredits")}
                        <span className="text-[10px] bg-muted border rounded px-1 py-0.5 font-mono text-muted-foreground/70">USD</span>
                      </span>
                      <span className="font-mono font-medium">${plan.monthlyCredits.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t("admin.plans.rateLimit")}</span>
                      <span className="font-mono font-medium">{plan.rpm} RPM</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Max API Keys</span>
                      <span className="font-mono font-medium">{(plan as Plan & { maxApiKeys?: number }).maxApiKeys ?? 3}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Max Webhooks</span>
                      <span className="font-mono font-medium">{(plan as Plan & { maxWebhooks?: number }).maxWebhooks ?? 3}</span>
                    </div>
                  </div>

                  {/* Models grouped by category */}
                  <div className="space-y-2">
                    <div className="text-sm font-medium">{t("admin.plans.allowedModels")}</div>

                    {grouped.text.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <Text className="h-3 w-3" /> {t("admin.plans.textModels")}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {grouped.text.map((id) => <ModelBadge key={id} modelId={id} />)}
                        </div>
                      </div>
                    )}

                    {grouped.image.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <Image className="h-3 w-3" /> {t("admin.plans.imageModels")}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {grouped.image.map((id) => <ModelBadge key={id} modelId={id} />)}
                        </div>
                      </div>
                    )}

                    {grouped.video.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <Video className="h-3 w-3" /> {t("admin.plans.videoModels")}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {grouped.video.map((id) => <ModelBadge key={id} modelId={id} />)}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Model Pricing Reference */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">{t("admin.plans.modelPricing")}</h2>
          <a
            href="https://ai.google.dev/gemini-api/docs/pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary flex items-center gap-1 hover:underline"
          >
            Google Pricing Docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <Tabs defaultValue="text">
          <TabsList>
            <TabsTrigger value="text" className="flex items-center gap-1.5">
              <Text className="h-3.5 w-3.5" /> {t("admin.plans.textModels")}
            </TabsTrigger>
            <TabsTrigger value="image" className="flex items-center gap-1.5">
              <Image className="h-3.5 w-3.5" /> {t("admin.plans.imageModels")}
            </TabsTrigger>
            <TabsTrigger value="video" className="flex items-center gap-1.5">
              <Video className="h-3.5 w-3.5" /> {t("admin.plans.videoModels")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text">
            <Card>
              <CardContent className="pt-4">
                {textModels.map((m) => <ModelPricingRow key={m.id} model={m} />)}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="image">
            <Card>
              <CardContent className="pt-4">
                {imageModels.map((m) => <ModelPricingRow key={m.id} model={m} />)}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="video">
            <Card>
              <CardContent className="pt-4">
                {videoModels.map((m) => <ModelPricingRow key={m.id} model={m} />)}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit Plan Dialog */}
      <Dialog open={!!editingPlan} onOpenChange={(open) => { if (!open) setEditingPlan(null); }}>
        <DialogContent className="sm:max-w-[720px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("admin.plans.editPlan")}</DialogTitle>
            <DialogDescription>Update the plan settings and allowed models.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={editForm.control} name="name" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <Label>{t("admin.plans.planName")}</Label>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="description" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <Label>{t("admin.plans.description")}</Label>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="priceUsd" render={({ field }) => (
                  <FormItem>
                    <Label>Price (USD/mo)</Label>
                    <FormControl><Input type="number" min="0" step="0.01" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="monthlyCredits" render={({ field }) => (
                  <FormItem>
                    <Label>{t("admin.plans.monthlyCredits")}</Label>
                    <FormControl><Input type="number" min="0" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="rpm" render={({ field }) => (
                  <FormItem>
                    <Label>{t("admin.plans.rateLimit")}</Label>
                    <FormControl><Input type="number" min="1" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="maxApiKeys" render={({ field }) => (
                  <FormItem>
                    <Label>Max API Keys</Label>
                    <FormControl><Input type="number" min="1" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="maxWebhooks" render={({ field }) => (
                  <FormItem>
                    <Label>Max Webhooks</Label>
                    <FormControl><Input type="number" min="0" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.plans.allowedModels")}</Label>
                <FormField control={editForm.control} name="modelsAllowed" render={({ field }) => (
                  <FormItem>
                    <ModelPicker value={field.value} onChange={field.onChange} />
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingPlan(null)}>{t("common.cancel")}</Button>
                <Button type="submit" disabled={updatePlan.isPending}>
                  {updatePlan.isPending ? t("admin.plans.saving") : t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Create Plan Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[720px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("admin.plans.createPlan")}</DialogTitle>
            <DialogDescription>Define a new subscription plan for developers.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <Label>{t("admin.plans.planName")}</Label>
                      <FormControl>
                        <Input placeholder="Pro Tier" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <Label>{t("admin.plans.description")}</Label>
                      <FormControl>
                        <Input placeholder="Best for production..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="priceUsd"
                  render={({ field }) => (
                    <FormItem>
                      <Label>Price (USD/mo)</Label>
                      <FormControl>
                        <Input type="number" min="0" step="0.01" {...field} />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">{t("admin.plans.priceHelp")}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="monthlyCredits"
                  render={({ field }) => (
                    <FormItem>
                      <Label>{t("admin.plans.monthlyCredits")}</Label>
                      <FormControl>
                        <Input type="number" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="rpm"
                  render={({ field }) => (
                    <FormItem>
                      <Label>{t("admin.plans.rateLimit")}</Label>
                      <FormControl>
                        <Input type="number" min="1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="maxApiKeys"
                  render={({ field }) => (
                    <FormItem>
                      <Label>Max API Keys</Label>
                      <FormControl>
                        <Input type="number" min="1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Model selector */}
              <div className="space-y-2">
                <Label>{t("admin.plans.allowedModels")}</Label>
                <FormField
                  control={form.control}
                  name="modelsAllowed"
                  render={({ field }) => (
                    <FormItem>
                      <ModelPicker value={field.value} onChange={field.onChange} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={createPlan.isPending}>
                  {createPlan.isPending ? t("admin.plans.creating") : t("admin.plans.createPlan")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
