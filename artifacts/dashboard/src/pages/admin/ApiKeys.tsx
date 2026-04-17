import { useState } from "react";
import { useListApiKeys, useRevokeApiKey, getListApiKeysQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Key } from "lucide-react";
import { format } from "date-fns";

export default function AdminApiKeys() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [revokeId, setRevokeId] = useState<number | null>(null);

  const { data: keysData, isLoading, isError } = useListApiKeys({ page, limit: 50 });
  const revokeApiKey = useRevokeApiKey();

  const confirmRevoke = () => {
    if (!revokeId) return;
    revokeApiKey.mutate(
      { id: revokeId },
      {
        onSuccess: () => {
          toast({ title: "API key revoked successfully" });
          queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
        },
        onError: (err) => {
          toast({ title: "Error revoking key", description: err.message, variant: "destructive" });
        },
        onSettled: () => setRevokeId(null),
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Global API Keys</h1>
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key Prefix</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Developer ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">Loading API keys...</TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-destructive">Failed to load API keys. Please refresh the page.</TableCell>
              </TableRow>
            ) : keysData?.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No API keys found.</TableCell>
              </TableRow>
            ) : (
              keysData?.items.map((apiKey) => (
                <TableRow key={apiKey.id}>
                  <TableCell className="font-mono text-xs flex items-center">
                    <Key className="h-3 w-3 mr-2 text-muted-foreground" />
                    {apiKey.keyPrefix}...
                  </TableCell>
                  <TableCell>{apiKey.name || "—"}</TableCell>
                  <TableCell>#{apiKey.userId}</TableCell>
                  <TableCell>
                    {apiKey.isActive && !apiKey.revokedAt ? (
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Revoked</Badge>
                    )}
                  </TableCell>
                  <TableCell>{apiKey.creditBalance.toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(apiKey.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    {apiKey.isActive && !apiKey.revokedAt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevokeId(apiKey.id)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={revokeId !== null} onOpenChange={(open) => { if (!open) setRevokeId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently revoke the key. Any requests using it will immediately fail. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revokeApiKey.isPending}
            >
              {revokeApiKey.isPending ? "Revoking..." : "Revoke Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
