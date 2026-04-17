import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { authFetch } from "@/lib/authFetch";
import { FileText, ChevronLeft, ChevronRight } from "lucide-react";

interface LogRow {
  id: number;
  apiKeyId: number;
  model: string | null;
  endpoint: string | null;
  statusCode: number | null;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  requestId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface LogDetail extends LogRow {
  requestBody: string | null;
  responseBody: string | null;
  keyName: string | null;
}

export default function PortalLogs() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const limit = 50;

  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (modelFilter.trim()) params.set("model", modelFilter.trim());

  const { data, isLoading } = useQuery({
    queryKey: ["portal-logs", page, statusFilter, modelFilter],
    queryFn: async () => {
      const res = await authFetch(`/api/portal/logs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load logs");
      return res.json() as Promise<{ logs: LogRow[]; page: number; limit: number; total: number }>;
    },
  });

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ["portal-log-detail", selectedId],
    enabled: selectedId != null,
    queryFn: async () => {
      const res = await authFetch(`/api/portal/logs/${selectedId}`);
      if (!res.ok) throw new Error("Failed to load log");
      return res.json() as Promise<LogDetail>;
    },
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-7 w-7" /> Request Logs
          </h1>
          <p className="text-muted-foreground mt-1">Inspect every API request, response, and cost.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Narrow down logs by status or model.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-64">
            <label className="text-xs text-muted-foreground">Model contains</label>
            <Input value={modelFilter} onChange={(e) => { setModelFilter(e.target.value); setPage(1); }} placeholder="gemini-2.5-flash" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Requests</CardTitle>
          <CardDescription>{data ? `${data.total.toLocaleString()} total` : "Loading…"}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : data && data.logs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3">Time</th>
                    <th className="py-2 pr-3">Endpoint</th>
                    <th className="py-2 pr-3">Model</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Tokens</th>
                    <th className="py-2 pr-3 text-right">Cost</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.logs.map((log) => (
                    <tr key={log.id} className="border-b hover:bg-muted/30">
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{log.endpoint ?? "—"}</td>
                      <td className="py-2 pr-3">{log.model ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={log.status === "success" ? "default" : "destructive"}>
                          {log.statusCode ?? log.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{((log.inputTokens ?? 0) + (log.outputTokens ?? 0)).toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">${Number(log.costUsd ?? 0).toFixed(6)}</td>
                      <td className="py-2 pr-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedId(log.id)}>View</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">No logs match your filters.</p>
          )}

          {data && totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={selectedId != null} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Request Detail</SheetTitle>
            <SheetDescription>{detail?.requestId ?? "—"}</SheetDescription>
          </SheetHeader>
          {loadingDetail ? (
            <div className="space-y-3 mt-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>
          ) : detail ? (
            <div className="space-y-4 mt-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-muted-foreground">Endpoint</div><div className="font-mono">{detail.endpoint ?? "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Status</div><div>{detail.statusCode} ({detail.status})</div></div>
                <div><div className="text-xs text-muted-foreground">Model</div><div>{detail.model ?? "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">API Key</div><div>{detail.keyName ?? `#${detail.apiKeyId}`}</div></div>
                <div><div className="text-xs text-muted-foreground">Tokens</div><div>{(detail.inputTokens ?? 0).toLocaleString()} in / {(detail.outputTokens ?? 0).toLocaleString()} out</div></div>
                <div><div className="text-xs text-muted-foreground">Cost</div><div>${Number(detail.costUsd ?? 0).toFixed(6)}</div></div>
              </div>
              {detail.errorMessage && (
                <div>
                  <div className="text-xs font-medium mb-1">Error</div>
                  <pre className="bg-destructive/10 border border-destructive/30 text-destructive text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap">{detail.errorMessage}</pre>
                </div>
              )}
              <div>
                <div className="text-xs font-medium mb-1">Request Body</div>
                <pre className="bg-muted text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-64">{detail.requestBody ?? "—"}</pre>
              </div>
              <div>
                <div className="text-xs font-medium mb-1">Response Body</div>
                <pre className="bg-muted text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-64">{detail.responseBody ?? "—"}</pre>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
