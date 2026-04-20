import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useCreateProvider, useUpdateProvider, useDeleteProvider, useTestProvider, getListProvidersQueryKey, type TestProviderResult } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Cloud, CheckCircle2, XCircle, Wifi, Loader2, AlertTriangle, RotateCw, ArrowUp, ArrowDown } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// The shape returned by /admin/providers — extended beyond the auto-generated
// type (which only knows about the original 5 fields).
interface ProviderWithHealth {
  id: number;
  name: string;
  projectId: string;
  location: string;
  isActive: boolean;
  priority: number;
  status: "healthy" | "degraded" | "down";
  circuitOpenUntil: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProviderForm {
  name: string;
  projectId: string;
  location: string;
  credentialsJson: string;
  isActive: boolean;
  priority: number;
}

const emptyForm: ProviderForm = {
  name: "",
  projectId: "",
  location: "us-central1",
  credentialsJson: "",
  isActive: true,
  priority: 100,
};

export default function AdminProviders() {
  // Use a direct query (instead of useListProviders hook) so we get the
  // extended fields (priority, status, lastError, ...) that aren't in the
  // auto-generated type yet.
  const { data: providers = [], isLoading, isError } = useQuery<ProviderWithHealth[]>({
    queryKey: getListProvidersQueryKey(),
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/providers`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load providers");
      return res.json() as Promise<ProviderWithHealth[]>;
    },
    refetchInterval: 15_000, // refresh status every 15s for live health badges
  });
  const queryClient = useQueryClient();
  const createProvider = useCreateProvider();
  const updateProvider = useUpdateProvider();
  const deleteProvider = useDeleteProvider();
  const testProvider = useTestProvider();
  const { toast } = useToast();

  const resetMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API_BASE}/api/admin/providers/${id}/reset`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Provider reset — circuit breaker cleared" });
      queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
    },
    onError: (e: Error) => toast({ title: "Reset failed", description: e.message, variant: "destructive" }),
  });

  const priorityMutation = useMutation({
    mutationFn: async (args: { id: number; priority: number }) => {
      const res = await fetch(`${API_BASE}/api/admin/providers/${args.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: args.priority }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() }),
    onError: (e: Error) => toast({ title: "Reorder failed", description: e.message, variant: "destructive" }),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [jsonError, setJsonError] = useState("");
  const [testingId, setTestingId] = useState<number | null>(null);

  const handleTest = (id: number) => {
    setTestingId(id);
    testProvider.mutate(
      { id },
      {
        onSuccess: (result: TestProviderResult) => {
          toast({
            title: result.success ? "✓ Connection successful" : "✗ Connection failed",
            description: result.message,
            variant: result.success ? "default" : "destructive",
          });
          queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
        },
        onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
        onSettled: () => setTestingId(null),
      }
    );
  };

  const openCreate = () => {
    setEditingId(null);
    // Default new providers to a priority HIGHER (= numerically lower) than
    // any existing one so newly added accounts become primary by default.
    // Falling back to 100 keeps legacy behavior when the list is empty.
    const minPriority = providers.length > 0 ? Math.min(...providers.map(p => p.priority)) : 100;
    setForm({ ...emptyForm, priority: Math.max(0, minPriority - 10) });
    setJsonError("");
    setDialogOpen(true);
  };

  const openEdit = (p: ProviderWithHealth) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      projectId: p.projectId,
      location: p.location,
      credentialsJson: "",
      isActive: p.isActive,
      priority: p.priority,
    });
    setJsonError("");
    setDialogOpen(true);
  };

  const validateJson = (val: string): boolean => {
    if (!val.trim()) {
      setJsonError("");
      return true;
    }
    try {
      JSON.parse(val);
      setJsonError("");
      return true;
    } catch {
      setJsonError("Invalid JSON — paste the full service account key file");
      return false;
    }
  };

  const handleSave = (): void => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (!form.projectId.trim()) { toast({ title: "Project ID is required", variant: "destructive" }); return; }

    if (editingId === null) {
      if (!form.credentialsJson.trim()) {
        toast({ title: "Service account JSON is required", variant: "destructive" }); return;
      }
      if (!validateJson(form.credentialsJson)) return;

      // priority is not in the auto-generated type — cast to allow extra field
      createProvider.mutate(
        {
          data: {
            name: form.name,
            projectId: form.projectId,
            location: form.location,
            credentialsJson: form.credentialsJson,
            isActive: form.isActive,
            priority: form.priority,
          } as never,
        },
        {
          onSuccess: () => {
            toast({ title: "Provider added successfully" });
            setDialogOpen(false);
            queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
          },
          onError: (e) => toast({ title: "Failed to add provider", description: e.message, variant: "destructive" }),
        }
      );
    } else {
      if (form.credentialsJson.trim() && !validateJson(form.credentialsJson)) return;

      updateProvider.mutate(
        {
          id: editingId,
          data: {
            name: form.name,
            projectId: form.projectId,
            location: form.location,
            ...(form.credentialsJson.trim() ? { credentialsJson: form.credentialsJson } : {}),
            isActive: form.isActive,
            priority: form.priority,
          } as never,
        },
        {
          onSuccess: () => {
            toast({ title: "Provider updated successfully" });
            setDialogOpen(false);
            queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
          },
          onError: (e) => toast({ title: "Failed to update provider", description: e.message, variant: "destructive" }),
        }
      );
    }
  };

  const handleToggleActive = (p: ProviderWithHealth) => {
    updateProvider.mutate(
      { id: p.id, data: { isActive: !p.isActive } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() }),
        onError: (e) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
      }
    );
  };

  const handleMove = (idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= providers.length) return;
    const a = providers[idx];
    const b = providers[target];
    // Swap priorities. If they're equal, give `a` one less than `b`.
    const aNew = b.priority === a.priority ? Math.max(0, b.priority - 1) : b.priority;
    const bNew = a.priority;
    Promise.all([
      priorityMutation.mutateAsync({ id: a.id, priority: aNew }),
      priorityMutation.mutateAsync({ id: b.id, priority: bNew }),
    ]).then(() => queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() }));
  };

  const handleDelete = () => {
    if (deleteId === null) return;
    deleteProvider.mutate(
      { id: deleteId },
      {
        onSuccess: () => {
          toast({ title: "Provider deleted" });
          setDeleteId(null);
          queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
        },
        onError: (e) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
      }
    );
  };

  const isPending = createProvider.isPending || updateProvider.isPending;

  const renderStatusBadge = (p: ProviderWithHealth) => {
    if (!p.isActive) {
      return <Badge variant="secondary" className="text-xs"><XCircle className="h-3 w-3 mr-1" /> Inactive</Badge>;
    }
    if (p.status === "down") {
      const minutes = p.circuitOpenUntil
        ? Math.max(1, Math.ceil((new Date(p.circuitOpenUntil).getTime() - Date.now()) / 60_000))
        : null;
      return <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-xs">
        <XCircle className="h-3 w-3 mr-1" /> Down{minutes ? ` (${minutes}m)` : ""}
      </Badge>;
    }
    if (p.status === "degraded") {
      return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 text-xs">
        <AlertTriangle className="h-3 w-3 mr-1" /> Degraded ({p.consecutiveFailures})
      </Badge>;
    }
    return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-xs">
      <CheckCircle2 className="h-3 w-3 mr-1" /> Healthy
    </Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vertex AI Providers</h1>
          <p className="text-muted-foreground mt-1">
            Manage Google Cloud accounts. Higher priority accounts are tried first; on failure, traffic automatically fails over to the next.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Add Provider
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading providers...</div>
      ) : isError ? (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          Failed to load providers. Please refresh the page.
        </div>
      ) : providers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="bg-muted rounded-full p-4">
              <Cloud className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium">No providers configured</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add a Google Cloud service account to start proxying Vertex AI requests.
              </p>
            </div>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" /> Add your first provider
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {providers.map((p, idx) => (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {/* Priority controls */}
                    <div className="flex flex-col gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={idx === 0 || priorityMutation.isPending}
                        onClick={() => handleMove(idx, -1)}
                        title="Move up (higher priority)"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-[10px] font-mono text-muted-foreground text-center">
                        #{idx + 1}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={idx === providers.length - 1 || priorityMutation.isPending}
                        onClick={() => handleMove(idx, 1)}
                        title="Move down (lower priority)"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="bg-primary/10 rounded-lg p-2">
                      <Cloud className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                        {p.name}
                        {renderStatusBadge(p)}
                      </CardTitle>
                      <CardDescription className="mt-0.5">
                        Project: <span className="font-mono text-xs">{p.projectId}</span>
                        {" · "}
                        Location: <span className="font-mono text-xs">{p.location}</span>
                        {" · "}
                        Priority: <span className="font-mono text-xs">{p.priority}</span>
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <Switch
                      checked={p.isActive}
                      onCheckedChange={() => handleToggleActive(p)}
                    />
                    {p.status === "down" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resetMutation.mutate(p.id)}
                        disabled={resetMutation.isPending}
                        title="Clear circuit breaker — re-enable immediately"
                      >
                        <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Reset
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTest(p.id)}
                      disabled={testingId === p.id}
                    >
                      {testingId === p.id ? (
                        <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Testing...</>
                      ) : (
                        <><Wifi className="h-3.5 w-3.5 mr-1.5" /> Test</>
                      )}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteId(p.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-1">
                {p.lastError && (
                  <div className="text-xs bg-destructive/5 border border-destructive/20 rounded p-2 font-mono text-destructive break-words">
                    Last error: {p.lastError}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {p.lastSuccessAt ? `Last success: ${new Date(p.lastSuccessAt).toLocaleString()}` : "Not yet used"}
                  {p.lastFailureAt ? ` · Last failure: ${new Date(p.lastFailureAt).toLocaleString()}` : ""}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Provider" : "Add Vertex AI Provider"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the provider details. Leave credentials empty to keep existing."
                : "Enter your Google Cloud project details and service account credentials."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input
                placeholder="e.g. Production Account"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Google Cloud Project ID</Label>
              <Input
                placeholder="e.g. my-project-123456"
                value={form.projectId}
                onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Location / Region</Label>
              <Input
                placeholder="us-central1"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Common: us-central1, us-east4, europe-west1, asia-southeast1
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Input
                type="number"
                min={0}
                max={10000}
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) || 0 }))}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Lower number = used first. Equal numbers tie-break by creation date.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>
                Service Account JSON{" "}
                {editingId && (
                  <span className="text-muted-foreground font-normal">(leave empty to keep existing)</span>
                )}
              </Label>
              <Textarea
                placeholder='Paste the full contents of your service account key JSON file ({"type": "service_account", ...})'
                value={form.credentialsJson}
                onChange={(e) => {
                  setForm((f) => ({ ...f, credentialsJson: e.target.value }));
                  if (e.target.value.trim()) validateJson(e.target.value);
                  else setJsonError("");
                }}
                className="font-mono text-xs h-32 resize-none"
              />
              {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
              <p className="text-xs text-muted-foreground">
                Credentials are encrypted with AES-256-GCM before storage.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              />
              <Label className="cursor-pointer">Active (use this provider for AI requests)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending || !!jsonError}>
              {isPending ? "Saving..." : editingId ? "Save Changes" : "Add Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this provider?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the provider and its encrypted credentials. Any active AI
              requests using this provider will fail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleteProvider.isPending}
            >
              {deleteProvider.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
