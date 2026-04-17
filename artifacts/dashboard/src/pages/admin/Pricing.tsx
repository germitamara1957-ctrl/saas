import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Trash2, Plus, DollarSign, RefreshCw } from "lucide-react";

interface ModelCostRow {
  model: string;
  inputPer1M: number;
  outputPer1M: number;
  perImage: number | null;
  perSecond: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const MARKUP = 1.1;

function fmt(n: number) {
  return `$${n.toFixed(4)}`;
}

function ModelTypeBadge({ row }: { row: ModelCostRow }) {
  if (row.perImage != null) return <Badge variant="secondary" className="text-[10px]">Image</Badge>;
  if (row.perSecond != null) return <Badge variant="secondary" className="text-[10px]">Video</Badge>;
  return <Badge variant="outline" className="text-[10px]">Chat</Badge>;
}

function BilledCell({ row }: { row: ModelCostRow }) {
  if (row.perImage != null) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        {fmt(row.perImage * MARKUP)}<span className="text-muted-foreground/60">/img</span>
      </span>
    );
  }
  if (row.perSecond != null) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        {fmt(row.perSecond * MARKUP)}<span className="text-muted-foreground/60">/s</span>
      </span>
    );
  }
  return (
    <div className="font-mono text-xs text-muted-foreground space-y-0.5">
      <div><span className="text-muted-foreground/60 text-[10px]">in </span>{fmt(row.inputPer1M * MARKUP)}</div>
      <div><span className="text-muted-foreground/60 text-[10px]">out </span>{fmt(row.outputPer1M * MARKUP)}</div>
    </div>
  );
}

interface EditForm {
  inputPer1M: string;
  outputPer1M: string;
  perImage: string;
  perSecond: string;
  isActive: boolean;
}

export default function AdminPricing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editingModel, setEditingModel] = useState<ModelCostRow | null>(null);
  const [deleteModel, setDeleteModel] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<{ model: string } & EditForm>({
    model: "", inputPer1M: "0", outputPer1M: "0", perImage: "", perSecond: "", isActive: true,
  });
  const [editForm, setEditForm] = useState<EditForm>({
    inputPer1M: "0", outputPer1M: "0", perImage: "", perSecond: "", isActive: true,
  });

  const { data: rows = [], isLoading } = useQuery<ModelCostRow[]>({
    queryKey: ["admin-model-costs"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/model-costs");
      if (!res.ok) throw new Error("Failed to load model costs");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ model, body }: { model: string; body: object }) => {
      const res = await authFetch(`/api/admin/model-costs/${encodeURIComponent(model)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error ?? "Request failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pricing updated" });
      queryClient.invalidateQueries({ queryKey: ["admin-model-costs"] });
      setEditingModel(null);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (body: object) => {
      const res = await authFetch("/api/admin/model-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error ?? "Request failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Model cost created" });
      queryClient.invalidateQueries({ queryKey: ["admin-model-costs"] });
      setCreateOpen(false);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (model: string) => {
      const res = await authFetch(`/api/admin/model-costs/${encodeURIComponent(model)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast({ title: "Model cost deleted" });
      queryClient.invalidateQueries({ queryKey: ["admin-model-costs"] });
      setDeleteModel(null);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openEdit = (row: ModelCostRow) => {
    setEditingModel(row);
    setEditForm({
      inputPer1M: String(row.inputPer1M),
      outputPer1M: String(row.outputPer1M),
      perImage: row.perImage != null ? String(row.perImage) : "",
      perSecond: row.perSecond != null ? String(row.perSecond) : "",
      isActive: row.isActive,
    });
  };

  const submitEdit = () => {
    if (!editingModel) return;
    const body: Record<string, unknown> = {
      inputPer1M: parseFloat(editForm.inputPer1M) || 0,
      outputPer1M: parseFloat(editForm.outputPer1M) || 0,
      perImage: editForm.perImage !== "" ? parseFloat(editForm.perImage) : null,
      perSecond: editForm.perSecond !== "" ? parseFloat(editForm.perSecond) : null,
      isActive: editForm.isActive,
    };
    updateMutation.mutate({ model: editingModel.model, body });
  };

  const submitCreate = () => {
    const body: Record<string, unknown> = {
      model: createForm.model.trim(),
      inputPer1M: parseFloat(createForm.inputPer1M) || 0,
      outputPer1M: parseFloat(createForm.outputPer1M) || 0,
      perImage: createForm.perImage !== "" ? parseFloat(createForm.perImage) : null,
      perSecond: createForm.perSecond !== "" ? parseFloat(createForm.perSecond) : null,
      isActive: createForm.isActive,
    };
    createMutation.mutate(body);
  };

  const activeCount = rows.filter(r => r.isActive).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="h-6 w-6" />
            Model Pricing
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage per-model prices. Changes take effect within 5 minutes across all requests.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Model
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Models</CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{rows.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Models</CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold text-green-600">{activeCount}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Markup Factor</CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">1.1×</p></CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Model Costs</CardTitle>
          <CardDescription>
            Base prices before 1.1× markup. The "Billed" column shows what users are charged.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Model</th>
                    <th className="text-left px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">Type</th>
                    <th className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">Input /1M</th>
                    <th className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">Output /1M</th>
                    <th className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">Per Image</th>
                    <th className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">Per Sec</th>
                    <th className="text-right px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">Billed (×1.1)</th>
                    <th className="text-center px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr
                      key={row.model}
                      className={`hover:bg-muted/20 transition-colors ${!row.isActive ? "opacity-40" : ""}`}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs max-w-[200px] truncate" title={row.model}>
                        {row.model}
                      </td>
                      <td className="px-3 py-2.5">
                        <ModelTypeBadge row={row} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        {row.inputPer1M > 0 ? fmt(row.inputPer1M) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        {row.outputPer1M > 0 ? fmt(row.outputPer1M) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        {row.perImage != null ? fmt(row.perImage) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        {row.perSecond != null ? fmt(row.perSecond) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <BilledCell row={row} />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge
                          variant={row.isActive ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {row.isActive ? "Active" : "Off"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(row)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon" variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteModel(row.model)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editingModel !== null} onOpenChange={(open) => { if (!open) setEditingModel(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Pricing</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{editingModel?.model}</span>
              {" "}— update base costs (before 1.1× markup).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Input per 1M tokens ($)</Label>
                <Input type="number" step="0.0001" min="0" value={editForm.inputPer1M}
                  onChange={e => setEditForm(f => ({ ...f, inputPer1M: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Output per 1M tokens ($)</Label>
                <Input type="number" step="0.0001" min="0" value={editForm.outputPer1M}
                  onChange={e => setEditForm(f => ({ ...f, outputPer1M: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Per Image ($) <span className="text-muted-foreground text-xs">— blank if N/A</span></Label>
                <Input type="number" step="0.0001" min="0" value={editForm.perImage}
                  placeholder="e.g. 0.04"
                  onChange={e => setEditForm(f => ({ ...f, perImage: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Per Second ($) <span className="text-muted-foreground text-xs">— blank if N/A</span></Label>
                <Input type="number" step="0.0001" min="0" value={editForm.perSecond}
                  placeholder="e.g. 0.50"
                  onChange={e => setEditForm(f => ({ ...f, perSecond: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox" id="edit-active"
                checked={editForm.isActive}
                onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))}
                className="rounded"
              />
              <Label htmlFor="edit-active">Active (included in billing)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingModel(null)}>Cancel</Button>
            <Button onClick={submitEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <RefreshCw className="h-4 w-4 animate-spin mr-2" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Model Pricing</DialogTitle>
            <DialogDescription>Add a new model with its base costs (before 1.1× markup).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Model ID</Label>
              <Input placeholder="e.g. gemini-3.1-pro-preview" value={createForm.model}
                onChange={e => setCreateForm(f => ({ ...f, model: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Input per 1M tokens ($)</Label>
                <Input type="number" step="0.0001" min="0" value={createForm.inputPer1M}
                  onChange={e => setCreateForm(f => ({ ...f, inputPer1M: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Output per 1M tokens ($)</Label>
                <Input type="number" step="0.0001" min="0" value={createForm.outputPer1M}
                  onChange={e => setCreateForm(f => ({ ...f, outputPer1M: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Per Image ($) <span className="text-muted-foreground text-xs">— blank if N/A</span></Label>
                <Input type="number" step="0.0001" min="0" value={createForm.perImage}
                  placeholder="e.g. 0.04"
                  onChange={e => setCreateForm(f => ({ ...f, perImage: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Per Second ($) <span className="text-muted-foreground text-xs">— blank if N/A</span></Label>
                <Input type="number" step="0.0001" min="0" value={createForm.perSecond}
                  placeholder="e.g. 0.50"
                  onChange={e => setCreateForm(f => ({ ...f, perSecond: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={createMutation.isPending || !createForm.model.trim()}>
              {createMutation.isPending && <RefreshCw className="h-4 w-4 animate-spin mr-2" />}
              Add Model
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteModel !== null} onOpenChange={(open) => { if (!open) setDeleteModel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Model Pricing</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete pricing for{" "}
              <span className="font-mono font-semibold">{deleteModel}</span>?
              The hardcoded fallback price will be used if this model is requested.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteModel && deleteMutation.mutate(deleteModel)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
