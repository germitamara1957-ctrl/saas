import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Webhook, Plus, Trash2, TestTube, Copy, Eye, EyeOff, Zap } from "lucide-react";
import { authFetch } from "@/lib/authFetch";

const AVAILABLE_EVENTS = [
  { id: "usage.success", label: "Request Success", description: "Fired after every successful API call" },
  { id: "usage.error", label: "Request Error", description: "Fired when an API call fails" },
  { id: "usage.rejected", label: "Request Rejected", description: "Fired when a request is rejected (rate limit, guardrail, etc.)" },
  { id: "low_balance", label: "Low Balance", description: "Fired when account credit falls below threshold" },
  { id: "video.completed", label: "Video Completed", description: "Fired when a Veo video generation job completes successfully" },
  { id: "video.failed", label: "Video Failed", description: "Fired when a Veo video generation job fails (after refund)" },
  { id: "spending.alert", label: "Spending Alert", description: "Fired when spending crosses your alert threshold" },
  { id: "spending.limit_reached", label: "Spending Limit Reached", description: "Fired when daily/monthly spending cap is hit (request blocked)" },
];

interface WebhookEntry {
  id: number;
  name: string;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
}

function CopyButton({ text }: { text: string }) {
  const { toast } = useToast();
  return (
    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
      navigator.clipboard.writeText(text);
      toast({ title: "Copied to clipboard" });
    }}>
      <Copy className="h-3 w-3" />
    </Button>
  );
}

function SecretDisplay({ secret }: { secret: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
      <span>{visible ? secret : "••••••••••••••••••••••••"}</span>
      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setVisible(!visible)}>
        {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </Button>
      <CopyButton text={secret} />
    </div>
  );
}

function CreateWebhookDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) {
      toast({ title: "Name and URL are required", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch("/api/portal/webhooks", {
        method: "POST",
        body: JSON.stringify({ name, url, events }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to create webhook");
      }
      toast({ title: "Webhook created successfully" });
      setOpen(false);
      setName(""); setUrl(""); setEvents([]);
      onCreated();
    } catch (e) {
      toast({ title: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const toggleEvent = (id: string) =>
    setEvents((prev) => prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" />Add Webhook</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Webhook</DialogTitle>
          <DialogDescription>
            Receive real-time POST notifications to your URL when events occur.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input placeholder="My Monitoring Webhook" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Endpoint URL</Label>
            <Input placeholder="https://your-server.com/webhook" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>
              Events{" "}
              <span className="text-muted-foreground text-xs font-normal">(leave empty = all events)</span>
            </Label>
            {AVAILABLE_EVENTS.map((ev) => (
              <div key={ev.id} className="flex items-start gap-3">
                <Checkbox
                  id={ev.id}
                  checked={events.includes(ev.id)}
                  onCheckedChange={() => toggleEvent(ev.id)}
                  className="mt-0.5"
                />
                <div>
                  <label htmlFor={ev.id} className="text-sm font-medium cursor-pointer">{ev.label}</label>
                  <p className="text-xs text-muted-foreground">{ev.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>{loading ? "Creating..." : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PortalWebhooks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: webhooks, isLoading } = useQuery<WebhookEntry[]>({
    queryKey: ["portal-webhooks"],
    queryFn: async () => {
      const res = await authFetch("/api/portal/webhooks");
      if (!res.ok) throw new Error("Failed to load webhooks");
      return res.json();
    },
  });

  const refetch = () => queryClient.invalidateQueries({ queryKey: ["portal-webhooks"] });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await authFetch(`/api/portal/webhooks/${id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to update webhook");
    },
    onSuccess: () => refetch(),
    onError: (e) => toast({ title: String(e instanceof Error ? e.message : e), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await authFetch(`/api/portal/webhooks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete webhook");
    },
    onSuccess: () => { refetch(); toast({ title: "Webhook deleted" }); },
    onError: (e) => toast({ title: String(e instanceof Error ? e.message : e), variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await authFetch(`/api/portal/webhooks/${id}/test`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to send test event");
    },
    onSuccess: () => toast({ title: "Test event dispatched", description: "Check your endpoint for the incoming request." }),
    onError: (e) => toast({ title: String(e instanceof Error ? e.message : e), variant: "destructive" }),
  });

  const rotateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await authFetch(`/api/portal/webhooks/${id}/rotate-secret`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to rotate secret");
      return res.json();
    },
    onSuccess: () => {
      void refetch();
      toast({ title: "Secret rotated", description: "Old secret stops working immediately. Update your verifier with the new value." });
    },
    onError: (e) => toast({ title: String(e instanceof Error ? e.message : e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Webhooks</h1>
          <p className="text-muted-foreground mt-2">
            Receive real-time notifications for API events via HTTP POST.
          </p>
        </div>
        <CreateWebhookDialog onCreated={refetch} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" />How it works
          </CardTitle>
          <CardDescription>
            Each event sends a signed JSON POST to your URL. Verify requests using the HMAC-SHA256
            signature in the{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">X-Gateway-Signature</code> header.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted rounded-md p-4 text-xs overflow-x-auto whitespace-pre-wrap">{`// Verify signature (Node.js)
const crypto = require("crypto");
const sig = req.headers["x-gateway-signature"];
const expected = "sha256=" + crypto
  .createHmac("sha256", YOUR_WEBHOOK_SECRET)
  .update(JSON.stringify(req.body))
  .digest("hex");
if (sig !== expected) return res.status(401).send("Invalid signature");

// Payload shape
{
  "event": "usage.success",
  "timestamp": "2026-04-14T21:00:00.000Z",
  "data": { "model": "gemini-2.5-flash", "costUsd": 0.000042, ... }
}`}</pre>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !webhooks || webhooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border rounded-lg border-dashed text-muted-foreground gap-3">
          <Webhook className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No webhooks configured yet</p>
          <p className="text-xs">Create one to start receiving real-time event notifications.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map((hook) => (
            <Card key={hook.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-base">{hook.name}</CardTitle>
                      <Badge variant={hook.isActive ? "default" : "secondary"}>
                        {hook.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <code className="text-xs text-muted-foreground truncate max-w-xs">{hook.url}</code>
                      <CopyButton text={hook.url} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={hook.isActive}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: hook.id, isActive: checked })}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testMutation.mutate(hook.id)}
                      disabled={testMutation.isPending}
                    >
                      <TestTube className="h-3 w-3 mr-1" />Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => rotateMutation.mutate(hook.id)}
                      disabled={rotateMutation.isPending}
                      title="Generate a new HMAC signing secret (old secret stops working immediately)"
                    >
                      Rotate Secret
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => deleteMutation.mutate(hook.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {hook.events.length === 0 ? (
                    <Badge variant="outline" className="text-xs">All events</Badge>
                  ) : (
                    hook.events.map((ev) => (
                      <Badge key={ev} variant="outline" className="text-xs font-mono">{ev}</Badge>
                    ))
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Secret:</span>
                  <SecretDisplay secret={hook.secret} />
                </div>
                {hook.lastTriggeredAt && (
                  <p className="text-xs text-muted-foreground">
                    Last triggered: {new Date(hook.lastTriggeredAt).toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
