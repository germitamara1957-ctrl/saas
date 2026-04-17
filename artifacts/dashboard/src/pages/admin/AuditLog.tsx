import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Search, RefreshCw, Shield, ChevronLeft, ChevronRight } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { useQuery } from "@tanstack/react-query";

interface AuditLogEntry {
  id: number;
  action: string;
  actorId: number | null;
  actorEmail: string | null;
  targetId: number | null;
  targetEmail: string | null;
  details: string | null;
  ip: string | null;
  createdAt: string;
}

interface AuditLogResponse {
  items: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}

const ACTION_COLORS: Record<string, string> = {
  "admin.login": "bg-blue-500/10 text-blue-600 border-blue-500/20",
  "admin.login.failed": "bg-red-500/10 text-red-600 border-red-500/20",
  "user.created": "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  "user.updated": "bg-amber-500/10 text-amber-600 border-amber-500/20",
  "user.deactivated": "bg-red-500/10 text-red-600 border-red-500/20",
  "user.credits.added": "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  "apikey.revoked": "bg-orange-500/10 text-orange-600 border-orange-500/20",
  "plan.created": "bg-purple-500/10 text-purple-600 border-purple-500/20",
  "plan.updated": "bg-purple-500/10 text-purple-600 border-purple-500/20",
  "plan.deleted": "bg-red-500/10 text-red-600 border-red-500/20",
};

function ActionBadge({ action }: { action: string }) {
  const color = ACTION_COLORS[action] ?? "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={`font-mono text-[11px] whitespace-nowrap ${color}`}>
      {action}
    </Badge>
  );
}

export default function AdminAuditLog() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pendingFrom, setPendingFrom] = useState("");
  const [pendingTo, setPendingTo] = useState("");
  const limit = 50;

  const { data, isLoading, isError, refetch, isFetching } = useQuery<AuditLogResponse>({
    queryKey: ["audit-log", page, search, from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await authFetch(`/api/admin/audit-log?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch audit log");
      return res.json();
    },
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  const applyFilters = () => {
    setSearch(searchInput);
    setFrom(pendingFrom);
    setTo(pendingTo);
    setPage(1);
  };

  const clearFilters = () => {
    setSearch("");
    setSearchInput("");
    setFrom("");
    setTo("");
    setPendingFrom("");
    setPendingTo("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground mt-1 text-sm">Track all admin actions and security events</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search action, email…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              />
            </div>
            <Input
              type="date"
              value={pendingFrom}
              onChange={(e) => setPendingFrom(e.target.value)}
              placeholder="From date"
            />
            <Input
              type="date"
              value={pendingTo}
              onChange={(e) => setPendingTo(e.target.value)}
              placeholder="To date"
            />
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={applyFilters}>Apply Filters</Button>
            {(search || from || to) && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isError && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          Failed to load audit log. Please refresh the page.
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                    No audit log entries found.
                  </TableCell>
                </TableRow>
              ) : (
                data?.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                      {format(new Date(entry.createdAt), "MMM dd HH:mm:ss")}
                    </TableCell>
                    <TableCell>
                      <ActionBadge action={entry.action} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {entry.actorEmail ? (
                        <span className="font-medium">{entry.actorEmail}</span>
                      ) : (
                        <span className="text-muted-foreground">System</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.targetEmail ?? (entry.targetId ? `#${entry.targetId}` : "—")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={entry.details ?? ""}>
                      {entry.details ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {entry.ip ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {data?.total.toLocaleString()} entries total
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
