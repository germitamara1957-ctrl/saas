import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListProviders, useCreateProvider, useUpdateProvider, useDeleteProvider, useTestProvider, getListProvidersQueryKey, type TestProviderResult } from "@workspace/api-client-react";
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
import { Plus, Pencil, Trash2, Cloud, CheckCircle2, XCircle, Wifi, Loader2 } from "lucide-react";

interface ProviderForm {
  name: string;
  projectId: string;
  location: string;
  credentialsJson: string;
  isActive: boolean;
}

const emptyForm: ProviderForm = {
  name: "",
  projectId: "",
  location: "us-central1",
  credentialsJson: "",
  isActive: true,
};

export default function AdminProviders() {
  const { data: providers = [], isLoading, isError } = useListProviders();
  const queryClient = useQueryClient();
  const createProvider = useCreateProvider();
  const updateProvider = useUpdateProvider();
  const deleteProvider = useDeleteProvider();
  const testProvider = useTestProvider();
  const { toast } = useToast();

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
        },
        onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
        onSettled: () => setTestingId(null),
      }
    );
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setJsonError("");
    setDialogOpen(true);
  };

  const openEdit = (p: (typeof providers)[0]) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      projectId: p.projectId,
      location: p.location,
      credentialsJson: "",
      isActive: p.isActive,
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

      createProvider.mutate(
        {
          data: {
            name: form.name,
            projectId: form.projectId,
            location: form.location,
            credentialsJson: form.credentialsJson,
            isActive: form.isActive,
          },
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
          },
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

  const handleToggleActive = (p: (typeof providers)[0]) => {
    updateProvider.mutate(
      { id: p.id, data: { isActive: !p.isActive } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() }),
        onError: (e) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
      }
    );
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vertex AI Providers</h1>
          <p className="text-muted-foreground mt-1">
            Manage Google Cloud accounts used to proxy Vertex AI requests.
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
          {providers.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="bg-primary/10 rounded-lg p-2">
                      <Cloud className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {p.name}
                        {p.isActive ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            <XCircle className="h-3 w-3 mr-1" /> Inactive
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-0.5">
                        Project: <span className="font-mono text-xs">{p.projectId}</span>
                        {" · "}
                        Location: <span className="font-mono text-xs">{p.location}</span>
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={p.isActive}
                      onCheckedChange={() => handleToggleActive(p)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTest(p.id)}
                      disabled={testingId === p.id}
                    >
                      {testingId === p.id ? (
                        <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Testing...</>
                      ) : (
                        <><Wifi className="h-3.5 w-3.5 mr-1.5" /> Test Connection</>
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
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground">
                  Added {new Date(p.createdAt).toLocaleDateString()}
                  {" · "}
                  Updated {new Date(p.updatedAt).toLocaleDateString()}
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
