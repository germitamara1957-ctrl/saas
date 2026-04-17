import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import { CheckCircle2, AlertCircle, Ban, ChevronLeft, ChevronRight, X } from "lucide-react";

const PAGE_SIZE = 20;

const MODEL_COLORS = [
  "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
  "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(220,70%,50%)",
  "hsl(160,60%,40%)", "hsl(300,60%,50%)",
];

interface UsageLog {
  id: number;
  model: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  createdAt: string;
}

interface ModelStat {
  model: string;
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
}

interface UsageData {
  dailyUsage: Array<{ date: string; totalRequests: number; totalTokens: number; totalCostUsd: number }>;
  byModel: ModelStat[];
  recentLogs: UsageLog[];
  total: number;
  page: number;
  limit: number;
}

function usePortalUsage(days: number, page: number, modelFilter: string) {
  return useQuery<UsageData>({
    queryKey: ["portal-usage", days, page, modelFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(days), page: String(page), limit: String(PAGE_SIZE) });
      if (modelFilter) params.set("model", modelFilter);
      const res = await authFetch(`/api/portal/usage?${params}`);
      if (!res.ok) throw new Error("Failed to load usage");
      return res.json();
    },
  });
}

export default function PortalUsage() {
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const [modelFilter, setModelFilter] = useState("");

  const { data: usageData, isLoading, isError } = usePortalUsage(days, page, modelFilter);

  const totalPages = usageData ? Math.ceil(usageData.total / PAGE_SIZE) : 0;

  // recentLogs are already filtered server-side when modelFilter is set
  const filteredLogs = usageData?.recentLogs ?? [];

  const chartTooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    borderColor: "hsl(var(--border))",
    borderRadius: "8px",
  };
  const axisTickStyle = { fill: "hsl(var(--muted-foreground))", fontSize: 12 };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Usage</h1>
          <p className="text-muted-foreground mt-2">Monitor your token consumption and request history.</p>
        </div>
        <Select value={days.toString()} onValueChange={(v) => { setDays(parseInt(v)); setPage(1); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select timeframe" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isError && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          Failed to load usage data. Please refresh the page.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Token Consumption</CardTitle>
            <CardDescription>Daily total tokens used across all models.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="w-full h-[240px]" />
            ) : !usageData?.dailyUsage?.length ? (
              <div className="flex items-center justify-center h-[240px] border rounded-md border-dashed text-muted-foreground">
                No usage data for this period.
              </div>
            ) : (
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={usageData.dailyUsage} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={axisTickStyle}
                      tickFormatter={(v) => { try { return format(new Date(v), "MMM dd") } catch { return v } }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={axisTickStyle}
                      tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                    <RechartsTooltip contentStyle={chartTooltipStyle}
                      labelFormatter={(v) => { try { return format(new Date(v), "MMM dd, yyyy") } catch { return v } }} />
                    <Area type="monotone" dataKey="totalTokens" name="Tokens" stroke="hsl(var(--primary))"
                      strokeWidth={2} fillOpacity={1} fill="url(#colorTokens)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cost Over Time</CardTitle>
            <CardDescription>Daily API spend in USD.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="w-full h-[240px]" />
            ) : !usageData?.dailyUsage?.length ? (
              <div className="flex items-center justify-center h-[240px] border rounded-md border-dashed text-muted-foreground">
                No cost data for this period.
              </div>
            ) : (
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={usageData.dailyUsage} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={axisTickStyle}
                      tickFormatter={(v) => { try { return format(new Date(v), "MMM dd") } catch { return v } }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={axisTickStyle}
                      tickFormatter={(v) => `$${v.toFixed(4)}`} />
                    <RechartsTooltip contentStyle={chartTooltipStyle}
                      formatter={(v: number) => [`$${v.toFixed(6)}`, "Cost"]}
                      labelFormatter={(v) => { try { return format(new Date(v), "MMM dd, yyyy") } catch { return v } }} />
                    <Area type="monotone" dataKey="totalCostUsd" name="Cost" stroke="hsl(var(--chart-2))"
                      strokeWidth={2} fillOpacity={1} fill="url(#colorCost)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cost-by-model donut + summary */}
      {usageData?.byModel && usageData.byModel.length > 0 && (
        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle>Spend Share by Model</CardTitle>
              <CardDescription>How your spending splits across models.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={usageData.byModel}
                      dataKey="totalCostUsd"
                      nameKey="model"
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={90}
                      paddingAngle={2}
                    >
                      {usageData.byModel.map((_, idx) => (
                        <Cell key={idx} fill={MODEL_COLORS[idx % MODEL_COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(value: number, name: string) => [`$${value.toFixed(6)}`, name]}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                      formatter={(v) => (typeof v === "string" && v.length > 18 ? `${v.slice(0, 16)}…` : v)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Spend Summary</CardTitle>
              <CardDescription>
                Total cost and token usage for the selected period.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(() => {
                  const totalCost = usageData.byModel.reduce((s, m) => s + m.totalCostUsd, 0);
                  const totalReq = usageData.byModel.reduce((s, m) => s + m.totalRequests, 0);
                  const totalTokens = usageData.byModel.reduce((s, m) => s + m.totalTokens, 0);
                  const top = [...usageData.byModel].sort((a, b) => b.totalCostUsd - a.totalCostUsd)[0];
                  return [
                    { label: "Total spend", value: `$${totalCost.toFixed(6)}` },
                    { label: "Total requests", value: totalReq.toLocaleString() },
                    { label: "Total tokens", value: totalTokens.toLocaleString() },
                    { label: "Top model", value: top?.model ?? "—", small: true },
                  ].map((s) => (
                    <div key={s.label} className="rounded-md border bg-card p-3">
                      <div className="text-[11px] text-muted-foreground">{s.label}</div>
                      <div className={`mt-1 font-bold ${s.small ? "text-sm font-mono truncate" : "text-lg"}`}>
                        {s.value}
                      </div>
                    </div>
                  ));
                })()}
              </div>

              <div className="mt-4 space-y-1.5">
                {[...usageData.byModel]
                  .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
                  .slice(0, 5)
                  .map((m, idx) => {
                    const totalCost = usageData.byModel.reduce((s, x) => s + x.totalCostUsd, 0);
                    const pct = totalCost > 0 ? (m.totalCostUsd / totalCost) * 100 : 0;
                    return (
                      <div key={m.model} className="flex items-center gap-2 text-xs">
                        <span className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: MODEL_COLORS[idx % MODEL_COLORS.length] }} />
                        <span className="font-mono truncate flex-1">{m.model}</span>
                        <span className="text-muted-foreground tabular-nums w-16 text-right">{pct.toFixed(1)}%</span>
                        <span className="font-mono tabular-nums w-24 text-right">${m.totalCostUsd.toFixed(6)}</span>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Usage by Model</CardTitle>
          <CardDescription>
            Requests and cost breakdown per model. Click a bar to filter the request log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="w-full h-[220px]" />
          ) : !usageData?.byModel?.length ? (
            <div className="flex items-center justify-center h-[220px] border rounded-md border-dashed text-muted-foreground">
              No model data for this period.
            </div>
          ) : (
            <div className="space-y-4">
              {modelFilter && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Filtered by:</span>
                  <Badge variant="secondary" className="gap-1">
                    {modelFilter}
                    <button onClick={() => setModelFilter("")} className="hover:opacity-70">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                </div>
              )}
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={usageData.byModel}
                    margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    onClick={(data) => {
                      if (data?.activePayload?.[0]) {
                        const m = (data.activePayload[0].payload as ModelStat).model;
                        setModelFilter((prev) => prev === m ? "" : m);
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="model" axisLine={false} tickLine={false} tick={axisTickStyle}
                      tickFormatter={(v) => v.length > 14 ? `${v.slice(0, 12)}…` : v} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={axisTickStyle}
                      tickFormatter={(v) => String(v)} />
                    <RechartsTooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(value: number, name: string) => [
                        name === "totalCostUsd" ? `$${value.toFixed(6)}` : value.toLocaleString(),
                        name === "totalCostUsd" ? "Cost (USD)" : name === "totalTokens" ? "Tokens" : "Requests",
                      ]}
                    />
                    <Bar dataKey="totalRequests" name="Requests" radius={[4, 4, 0, 0]} cursor="pointer">
                      {usageData.byModel.map((_, idx) => (
                        <Cell
                          key={idx}
                          fill={MODEL_COLORS[idx % MODEL_COLORS.length]}
                          opacity={!modelFilter || usageData.byModel[idx].model === modelFilter ? 1 : 0.35}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {usageData.byModel.map((m, idx) => (
                  <button
                    key={m.model}
                    className={`text-left rounded-md border p-3 text-xs transition-colors hover:bg-muted/50 ${
                      modelFilter === m.model ? "border-primary bg-primary/5" : "border-border"
                    }`}
                    onClick={() => setModelFilter((prev) => prev === m.model ? "" : m.model)}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: MODEL_COLORS[idx % MODEL_COLORS.length] }}
                      />
                      <span className="font-mono font-medium truncate">{m.model}</span>
                    </div>
                    <div className="text-muted-foreground space-y-0.5">
                      <div>{m.totalRequests.toLocaleString()} requests</div>
                      <div>{m.totalTokens.toLocaleString()} tokens</div>
                      <div>${m.totalCostUsd.toFixed(6)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Recent Requests</CardTitle>
            <CardDescription>
              Detailed log of your API calls.
              {modelFilter && <span className="ml-1 text-primary">Showing: {modelFilter}</span>}
            </CardDescription>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Page {page} of {totalPages}</span>
              <Button variant="outline" size="icon" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Total Tokens</TableHead>
                  <TableHead className="text-right">Cost (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Loading recent requests...
                    </TableCell>
                  </TableRow>
                ) : filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {modelFilter ? `No requests found for ${modelFilter}.` : "No requests found."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.map((log) => (
                    <TableRow key={log.id} className="text-sm">
                      <TableCell className="text-muted-foreground">
                        {format(new Date(log.createdAt), "MMM d, HH:mm:ss")}
                      </TableCell>
                      <TableCell>
                        <button
                          className="font-medium font-mono text-xs hover:text-primary transition-colors"
                          onClick={() => setModelFilter((prev) => prev === log.model ? "" : log.model)}
                        >
                          {log.model}
                        </button>
                      </TableCell>
                      <TableCell>
                        {log.status === "success" ? (
                          <div className="flex items-center text-emerald-500">
                            <CheckCircle2 className="h-3 w-3 mr-1" />Success
                          </div>
                        ) : log.status === "rejected" ? (
                          <div className="flex items-center text-amber-500">
                            <Ban className="h-3 w-3 mr-1" />Rejected
                          </div>
                        ) : (
                          <div className="flex items-center text-destructive">
                            <AlertCircle className="h-3 w-3 mr-1" />Failed
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{log.inputTokens.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{log.outputTokens.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">{log.totalTokens.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-muted-foreground">${log.costUsd.toFixed(6)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
