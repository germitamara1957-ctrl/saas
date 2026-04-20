import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, Mail, CheckCircle2, Send, Globe, Video, Plus, Trash2, ShieldCheck, KeyRound, Copy, Webhook, Power, ShieldAlert } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

interface DocsVideo {
  title: string;
  url: string;
}

interface SettingsResponse {
  smtp_host: string | null;
  smtp_port: string | null;
  smtp_user: string | null;
  smtp_pass: string | null;
  smtp_from: string | null;
  app_base_url: string | null;
  docs_videos: DocsVideo[] | null;
}

interface SmtpSettings {
  smtp_host: string | null;
  smtp_port: string | null;
  smtp_user: string | null;
  smtp_pass: string | null;
  smtp_from: string | null;
  app_base_url: string | null;
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch(`${API_BASE}/api/admin/settings`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json() as Promise<SettingsResponse>;
}

async function saveSettings(data: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/settings`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
    throw new Error(err.error ?? "Failed to save settings");
  }
}

async function sendTestEmail(to: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/settings/test-email`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
    throw new Error(err.error ?? "Failed to send test email");
  }
}

export default function AdminSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState<SmtpSettings>({
    smtp_host: "",
    smtp_port: "587",
    smtp_user: "",
    smtp_pass: "",
    smtp_from: "",
    app_base_url: "",
  });

  const [videos, setVideos] = useState<DocsVideo[]>([]);
  const [savingVideos, setSavingVideos] = useState(false);

  useEffect(() => {
    fetchSettings()
      .then((data) => {
        setForm({
          smtp_host: data.smtp_host ?? "",
          smtp_port: data.smtp_port ?? "587",
          smtp_user: data.smtp_user ?? "",
          smtp_pass: data.smtp_pass ?? "",
          smtp_from: data.smtp_from ?? "",
          app_base_url: data.app_base_url ?? "",
        });
        setVideos(Array.isArray(data.docs_videos) ? data.docs_videos : []);
      })
      .catch(() => {
        toast({ title: "Error", description: "Could not load settings", variant: "destructive" });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleVideoChange = (index: number, field: "title" | "url", value: string) => {
    setVideos((vs) => vs.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  };

  const addVideo = () => {
    setVideos((vs) => [...vs, { title: "", url: "" }]);
  };

  const removeVideo = (index: number) => {
    setVideos((vs) => vs.filter((_, i) => i !== index));
  };

  const handleSaveVideos = async () => {
    const cleaned = videos
      .map((v) => ({ title: v.title.trim(), url: v.url.trim() }))
      .filter((v) => v.title.length > 0 && v.url.length > 0);

    for (const v of cleaned) {
      let proto: string;
      try {
        proto = new URL(v.url).protocol;
      } catch {
        toast({
          title: "Invalid URL",
          description: `"${v.url}" is not a valid URL`,
          variant: "destructive",
        });
        return;
      }
      if (proto !== "http:" && proto !== "https:") {
        toast({
          title: "Invalid URL scheme",
          description: `"${v.url}" must use http:// or https://`,
          variant: "destructive",
        });
        return;
      }
    }

    setSavingVideos(true);
    try {
      await saveSettings({ docs_videos: cleaned });
      setVideos(cleaned);
      toast({ title: "Saved", description: "Video tutorials saved successfully." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save videos",
        variant: "destructive",
      });
    } finally {
      setSavingVideos(false);
    }
  };

  const handleChange = (key: keyof SmtpSettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (form.smtp_host) payload.smtp_host = form.smtp_host;
      if (form.smtp_port) payload.smtp_port = form.smtp_port;
      if (form.smtp_user) payload.smtp_user = form.smtp_user;
      if (form.smtp_pass && form.smtp_pass !== "••••••••") payload.smtp_pass = form.smtp_pass;
      if (form.smtp_from) payload.smtp_from = form.smtp_from;
      if (form.app_base_url) payload.app_base_url = form.app_base_url;

      await saveSettings(payload);
      setSaved(true);
      toast({ title: "Saved", description: "SMTP settings saved successfully." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save settings",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmailAddress) {
      toast({ title: "Enter email", description: "Please enter an email address to send the test to.", variant: "destructive" });
      return;
    }
    setTestingEmail(true);
    try {
      await sendTestEmail(testEmailAddress);
      toast({ title: "Test email sent", description: `Test email sent to ${testEmailAddress}` });
    } catch (err) {
      toast({
        title: "Failed to send",
        description: err instanceof Error ? err.message : "Could not send test email",
        variant: "destructive",
      });
    } finally {
      setTestingEmail(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform Settings</h1>
        <p className="text-muted-foreground mt-1">Configure email delivery and platform integrations.</p>
      </div>

      {/* Video Tutorials moved to TOP for high visibility — admins land here first */}
      <Card className="border-primary/40 shadow-sm" data-testid="card-video-tutorials">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Video className="h-5 w-5 text-primary" />
            <CardTitle>Video Tutorials</CardTitle>
          </div>
          <CardDescription>
            Add YouTube tutorial links shown to developers at the TOP of the API Documentation page. Great for onboarding new users.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {videos.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No videos yet — click "Add video" below to add a tutorial link.
            </p>
          )}
          {videos.map((v, i) => (
            <div key={i} className="rounded-md border bg-muted/30 p-3 space-y-3" data-testid={`video-row-${i}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Video #{i + 1}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeVideo(i)}
                  aria-label="Remove video"
                  data-testid={`button-remove-video-${i}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`video-title-${i}`}>Title</Label>
                <Input
                  id={`video-title-${i}`}
                  placeholder="Getting Started with the AI Gateway"
                  value={v.title}
                  onChange={(e) => handleVideoChange(i, "title", e.target.value)}
                  data-testid={`input-video-title-${i}`}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`video-url-${i}`}>YouTube URL</Label>
                <Input
                  id={`video-url-${i}`}
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={v.url}
                  onChange={(e) => handleVideoChange(i, "url", e.target.value)}
                  type="url"
                  data-testid={`input-video-url-${i}`}
                />
                <p className="text-xs text-muted-foreground">
                  Paste any YouTube link (watch, youtu.be, embed, or shorts). Other http(s) links are also accepted.
                </p>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <Button variant="outline" onClick={addVideo} data-testid="button-add-video">
              <Plus className="h-4 w-4 mr-2" />
              Add video
            </Button>
            <Button onClick={handleSaveVideos} disabled={savingVideos} data-testid="button-save-videos">
              {savingVideos ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save videos
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <CardTitle>Platform URL</CardTitle>
          </div>
          <CardDescription>
            Used in email links (verification, password reset). Leave blank to auto-detect from the incoming request domain.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="app_base_url">App Base URL <span className="text-muted-foreground font-normal text-xs">(optional override)</span></Label>
            <Input
              id="app_base_url"
              placeholder="Auto-detected from domain — leave blank"
              value={form.app_base_url ?? ""}
              onChange={handleChange("app_base_url")}
              type="url"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty for automatic detection. Only set this if links in emails point to the wrong domain.
            </p>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : saved ? (
                <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {saved ? "Saved!" : "Save Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            <CardTitle>SMTP Email Settings</CardTitle>
          </div>
          <CardDescription>
            Configure your email server to send verification emails, password resets, and low-credit alerts to developers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="smtp_host">SMTP Host</Label>
              <Input
                id="smtp_host"
                placeholder="smtp.gmail.com"
                value={form.smtp_host ?? ""}
                onChange={handleChange("smtp_host")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp_port">Port</Label>
              <Input
                id="smtp_port"
                placeholder="587"
                value={form.smtp_port ?? ""}
                onChange={handleChange("smtp_port")}
                type="number"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtp_user">Username / Email</Label>
            <Input
              id="smtp_user"
              placeholder="your@email.com"
              value={form.smtp_user ?? ""}
              onChange={handleChange("smtp_user")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtp_pass">Password / App Password</Label>
            <Input
              id="smtp_pass"
              type="password"
              placeholder="Enter password (leave blank to keep current)"
              value={form.smtp_pass ?? ""}
              onChange={handleChange("smtp_pass")}
            />
            <p className="text-xs text-muted-foreground">
              For Gmail, use an <strong>App Password</strong> (16-character code).{" "}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:opacity-80"
              >
                Click here to generate one →
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtp_from">From Address</Label>
            <Input
              id="smtp_from"
              placeholder="noreply@yourdomain.com"
              value={form.smtp_from ?? ""}
              onChange={handleChange("smtp_from")}
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : saved ? (
                <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {saved ? "Saved!" : "Save Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            <CardTitle>Test Email</CardTitle>
          </div>
          <CardDescription>
            Send a test email to verify your SMTP configuration is working correctly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="recipient@example.com"
              value={testEmailAddress}
              onChange={(e) => setTestEmailAddress(e.target.value)}
              type="email"
              className="max-w-sm"
            />
            <Button variant="outline" onClick={handleTestEmail} disabled={testingEmail}>
              {testingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send Test
            </Button>
          </div>
        </CardContent>
      </Card>

      <EmailPolicyCard />

      <ChargilySecretsCard />

      <TwoFactorCard />
    </div>
  );
}

function EmailPolicyCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allowed, setAllowed] = useState("");
  const [blocked, setBlocked] = useState("");
  const [blockDisposable, setBlockDisposable] = useState(true);
  const [officialOnly, setOfficialOnly] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/admin/settings`, { credentials: "include" })
      .then((r) => r.json() as Promise<Record<string, unknown>>)
      .then((d) => {
        setAllowed(typeof d.signup_allowed_email_domains === "string" ? d.signup_allowed_email_domains : "");
        setBlocked(typeof d.signup_blocked_email_domains === "string" ? d.signup_blocked_email_domains : "");
        setBlockDisposable(d.signup_block_disposable == null ? true : d.signup_block_disposable !== "false");
        setOfficialOnly(d.signup_official_providers_only == null ? true : d.signup_official_providers_only !== "false");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({
        signup_allowed_email_domains: allowed.trim(),
        signup_blocked_email_domains: blocked.trim(),
        signup_block_disposable: blockDisposable ? "true" : "false",
        signup_official_providers_only: officialOnly ? "true" : "false",
      });
      toast({ title: "Saved", description: "Email signup policy updated." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" />
          <CardTitle>Signup Email Policy</CardTitle>
        </div>
        <CardDescription>
          Restrict which email addresses can register. Useful to prevent spam and bulk
          signups from disposable email services.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="allowed-domains">
                Allowed domains <span className="text-xs text-muted-foreground">(comma separated, leave empty to allow all)</span>
              </Label>
              <Textarea
                id="allowed-domains"
                placeholder="gmail.com, outlook.com, hotmail.com, yahoo.com"
                value={allowed}
                onChange={(e) => setAllowed(e.target.value)}
                rows={2}
                data-testid="input-allowed-domains"
              />
              <p className="text-xs text-muted-foreground">
                If set, ONLY these domains can register. Strict allowlist mode.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="blocked-domains">
                Blocked domains <span className="text-xs text-muted-foreground">(comma separated)</span>
              </Label>
              <Textarea
                id="blocked-domains"
                placeholder="example.com, spammer.io"
                value={blocked}
                onChange={(e) => setBlocked(e.target.value)}
                rows={2}
                data-testid="input-blocked-domains"
              />
              <p className="text-xs text-muted-foreground">
                Always rejected, regardless of allowlist.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="official-only" className="cursor-pointer">
                  Official providers only (recommended)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Restrict signup to mainstream providers: Gmail, Outlook, Hotmail, Live, Yahoo,
                  iCloud, Proton, AOL, GMX, Zoho, Yandex. Custom allowlist domains above are
                  added on top.
                </p>
              </div>
              <Switch
                id="official-only"
                checked={officialOnly}
                onCheckedChange={setOfficialOnly}
                data-testid="switch-official-only"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="block-disposable" className="cursor-pointer">
                  Block disposable / temporary emails
                </Label>
                <p className="text-xs text-muted-foreground">
                  Built-in blocklist of mailinator, tempmail, yopmail, guerrillamail, and ~80 others.
                </p>
              </div>
              <Switch
                id="block-disposable"
                checked={blockDisposable}
                onCheckedChange={setBlockDisposable}
                data-testid="switch-block-disposable"
              />
            </div>

            <Button onClick={handleSave} disabled={saving} data-testid="button-save-email-policy">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save Policy
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ChargilySecretsState {
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  secretKeySource: "db" | "env" | "missing";
  webhookSecretSource: "db" | "env" | "missing";
  mode: "test" | "live";
  webhookUrl: string;
}

function ChargilySecretsCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [state, setState] = useState<ChargilySecretsState | null>(null);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [secretsRes, settingsRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/billing/chargily/secrets`, { credentials: "include" }),
        fetch(`${API_BASE}/api/admin/billing/chargily/settings`, { credentials: "include" }),
      ]);
      if (!secretsRes.ok) throw new Error("Failed to load");
      const data = (await secretsRes.json()) as ChargilySecretsState;
      setState(data);
      if (settingsRes.ok) {
        const s = (await settingsRes.json()) as { enabled?: boolean };
        setEnabled(s.enabled !== false);
      }
    } catch {
      toast({ title: "Error", description: "Could not load Chargily settings", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleEnabled = async (checked: boolean) => {
    setTogglingEnabled(true);
    const prev = enabled;
    setEnabled(checked);
    try {
      const res = await fetch(`${API_BASE}/api/admin/billing/chargily/settings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: checked }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({
        title: checked ? "Top-ups enabled" : "Top-ups disabled",
        description: checked
          ? "Users can now pay via Chargily."
          : "Chargily top-ups are now blocked. Existing pending checkouts can still be paid.",
      });
    } catch {
      setEnabled(prev);
      toast({ title: "Error", description: "Failed to update", variant: "destructive" });
    } finally {
      setTogglingEnabled(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async () => {
    const payload: Record<string, string> = {};
    if (secretKey.trim()) payload.secretKey = secretKey.trim();
    if (webhookSecret.trim()) payload.webhookSecret = webhookSecret.trim();
    if (Object.keys(payload).length === 0) {
      toast({ title: "Nothing to save", description: "Enter at least one key.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/billing/chargily/secrets`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      const data = (await res.json()) as ChargilySecretsState;
      setState(data);
      setSecretKey("");
      setWebhookSecret("");
      toast({ title: "Saved", description: "Chargily keys updated." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Save failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const copyWebhookUrl = async () => {
    if (!state?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(state.webhookUrl);
      toast({ title: "Copied", description: "Webhook URL copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Please copy manually.", variant: "destructive" });
    }
  };

  const sourceLabel = (src: "db" | "env" | "missing"): { text: string; cls: string } => {
    if (src === "db") return { text: "Saved (database)", cls: "text-green-600" };
    if (src === "env") return { text: "From environment variable", cls: "text-blue-600" };
    return { text: "Not configured", cls: "text-destructive" };
  };

  return (
    <Card data-testid="card-chargily-secrets">
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <CardTitle>Chargily Pay (Algeria)</CardTitle>
        </div>
        <CardDescription>
          Configure the Chargily secret key and webhook secret used for DZD top-ups. Values are stored encrypted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : state ? (
          <>
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Power className={`h-4 w-4 ${enabled ? "text-green-600" : "text-muted-foreground"}`} />
                  <div>
                    <div className="text-sm font-medium">
                      {enabled ? "Top-ups enabled" : "Top-ups disabled"}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Master switch — disable to immediately stop new payments without removing keys.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={handleToggleEnabled}
                  disabled={togglingEnabled}
                  data-testid="switch-chargily-enabled"
                />
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">Mode</span>
                <span className={state.mode === "live" ? "text-amber-600 font-semibold" : "text-muted-foreground"}>
                  {state.mode.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Controlled by the <code>CHARGILY_MODE</code> environment variable.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Webhook className="h-4 w-4" /> Webhook URL (paste this in your Chargily dashboard)
              </Label>
              <div className="flex gap-2">
                <Input
                  value={state.webhookUrl}
                  readOnly
                  className="font-mono text-xs"
                  data-testid="input-chargily-webhook-url"
                />
                <Button variant="outline" onClick={copyWebhookUrl} data-testid="button-copy-webhook-url">
                  <Copy className="h-4 w-4 mr-2" /> Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Auto-generated from the current host. Re-copy this if your domain changes.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="chargily-secret-key">CHARGILY_SECRET_KEY</Label>
              <p className={`text-xs ${sourceLabel(state.secretKeySource).cls}`}>
                Status: {sourceLabel(state.secretKeySource).text}
              </p>
              <Input
                id="chargily-secret-key"
                type="password"
                placeholder={state.hasSecretKey ? "•••••••• (leave empty to keep current)" : "test_sk_... or live_sk_..."}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                autoComplete="off"
                data-testid="input-chargily-secret-key"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="chargily-webhook-secret">CHARGILY_WEBHOOK_SECRET</Label>
              <p className={`text-xs ${sourceLabel(state.webhookSecretSource).cls}`}>
                Status: {sourceLabel(state.webhookSecretSource).text}
              </p>
              <Input
                id="chargily-webhook-secret"
                type="password"
                placeholder={state.hasWebhookSecret ? "•••••••• (leave empty to keep current)" : "whsec_..."}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                autoComplete="off"
                data-testid="input-chargily-webhook-secret"
              />
            </div>

            <Button onClick={handleSave} disabled={saving} data-testid="button-save-chargily-secrets">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save Chargily Keys
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TwoFactorCard() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setupData, setSetupData] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/2fa/status", { credentials: "include" });
        if (!res.ok) return;
        const d = await res.json();
        setEnabled(Boolean(d.enabled));
      } catch {
        setEnabled(false);
      }
    })();
  }, []);

  const beginSetup = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/2fa/setup", { method: "POST", credentials: "include" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed to start 2FA setup");
      setSetupData({ qrDataUrl: d.qrDataUrl, secret: d.secret });
    } catch (e) {
      toast({ title: "2FA setup failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^[0-9]{6}$/.test(code)) {
      toast({ title: "Enter the 6-digit code from your authenticator app", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/2fa/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Verification failed");
      setEnabled(true);
      setSetupData(null);
      setCode("");
      toast({ title: "Two-factor authentication enabled" });
    } catch (e) {
      toast({ title: "Verification failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!/^[0-9]{6}$/.test(code)) {
      toast({ title: "Enter your current 6-digit code to disable 2FA", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/2fa/disable", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed to disable");
      setEnabled(false);
      setCode("");
      toast({ title: "Two-factor authentication disabled" });
    } catch (e) {
      toast({ title: "Failed to disable 2FA", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle>Two-Factor Authentication (TOTP)</CardTitle>
        </div>
        <CardDescription>
          Add a second factor (Google Authenticator, 1Password, Authy) to your admin login.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {enabled === null ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : enabled ? (
          <>
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium text-sm">2FA is enabled on this account.</span>
            </div>
            <div className="space-y-2 max-w-sm">
              <Label>Disable 2FA — enter current 6-digit code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="123456" />
              <Button variant="destructive" onClick={disable} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Disable 2FA
              </Button>
            </div>
          </>
        ) : setupData ? (
          <>
            <p className="text-sm">
              Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
            </p>
            <img src={setupData.qrDataUrl} alt="TOTP QR code" className="border rounded-md p-2 bg-white" width={220} height={220} />
            <p className="text-xs text-muted-foreground">
              Or enter this secret manually: <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">{setupData.secret}</code>
            </p>
            <div className="space-y-2 max-w-sm">
              <Label>Verification code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="123456" />
              <div className="flex gap-2">
                <Button onClick={verify} disabled={busy || code.length !== 6}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Verify & Enable
                </Button>
                <Button variant="outline" onClick={() => { setSetupData(null); setCode(""); }} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          </>
        ) : (
          <Button onClick={beginSetup} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
            Enable 2FA
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
