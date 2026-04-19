import { useEffect, useState } from "react";
import i18n from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Undo2, Gift, Users, Wallet, Clock, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authFetch";

interface AdminReferralData {
  settings: { enabled: boolean; rate: number; holdDays: number; minRedeemUsd: number };
  totals: {
    totalEarnings: number;
    totalReferrers: number;
    pendingUsd: number;
    availableUsd: number;
    paidUsd: number;
    reversedUsd: number;
    usersWithCode: number;
    referredUsers: number;
  };
  topReferrers: Array<{
    referrerId: number;
    email: string;
    name: string;
    referralCode: string | null;
    pendingUsd: number;
    availableUsd: number;
    redeemedUsd: number;
    reversedUsd: number;
    lifetimeUsd: number;
    earningCount: number;
  }>;
  recent: Array<{
    id: number;
    referrerEmail: string;
    referredEmail: string;
    sourceType: string;
    sourceId: string;
    basisAmountUsd: number;
    commissionUsd: number;
    status: "pending" | "available" | "redeemed" | "reversed";
    unlocksAt: string;
    createdAt: string;
  }>;
}

const fmt = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const fmtDate = (s: string, lang: string) => {
  try {
    return new Date(s).toLocaleString(lang === "ar" ? "ar-DZ" : "en-US", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return s; }
};

export default function AdminReferrals() {
  const { toast } = useToast();
  const isAr = i18n.language === "ar";

  const [data, setData] = useState<AdminReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reversingId, setReversingId] = useState<number | null>(null);

  // editable settings
  const [enabled, setEnabled] = useState(true);
  const [ratePct, setRatePct] = useState("8");
  const [holdDays, setHoldDays] = useState("14");
  const [minRedeem, setMinRedeem] = useState("10");

  const load = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/admin/referrals");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as AdminReferralData;
      setData(json);
      setEnabled(json.settings.enabled);
      setRatePct(String(Math.round(json.settings.rate * 100 * 100) / 100));
      setHoldDays(String(json.settings.holdDays));
      setMinRedeem(String(json.settings.minRedeemUsd));
    } catch (err) {
      toast({
        title: isAr ? "فشل التحميل" : "Failed to load",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const saveSettings = async () => {
    const rate = Number(ratePct) / 100;
    const hold = Number(holdDays);
    const min = Number(minRedeem);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      toast({ title: isAr ? "نسبة غير صالحة" : "Invalid rate", variant: "destructive" });
      return;
    }
    if (!Number.isInteger(hold) || hold < 0 || hold > 365) {
      toast({ title: isAr ? "أيام الحجز غير صالحة" : "Invalid hold days", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(min) || min < 0) {
      toast({ title: isAr ? "حد سحب غير صالح" : "Invalid min redeem", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/admin/referrals/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, rate, holdDays: hold, minRedeemUsd: min }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      toast({ title: isAr ? "تم الحفظ" : "Saved" });
      await load();
    } catch (err) {
      toast({
        title: isAr ? "فشل الحفظ" : "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally { setSaving(false); }
  };

  const reverseEarning = async (id: number) => {
    if (!confirm(isAr
      ? "هل أنت متأكد من عكس هذه العمولة؟ إذا كانت محوّلة بالفعل، سيتم خصم المبلغ من رصيد المُحيل."
      : "Are you sure you want to reverse this earning? If already redeemed, the amount will be debited from the referrer's balance.")) return;
    setReversingId(id);
    try {
      const res = await authFetch(`/api/admin/referrals/${id}/reverse`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      toast({
        title: isAr ? "تم العكس" : "Reversed",
        description: body.clawbackUsd > 0
          ? (isAr ? `استرداد: ${fmt(body.clawbackUsd)}` : `Clawback: ${fmt(body.clawbackUsd)}`)
          : undefined,
      });
      await load();
    } catch (err) {
      toast({
        title: isAr ? "فشل العكس" : "Reverse failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally { setReversingId(null); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]" dir={isAr ? "rtl" : "ltr"}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-6" dir={isAr ? "rtl" : "ltr"}>
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Gift className="h-7 w-7 text-primary" />
          {isAr ? "نظام الإحالة" : "Referral Program"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {isAr
            ? "تدفق المُحيلين، الإعدادات، والعمولات. العمولة تُحسب من المبلغ المدفوع فعلياً، لا من قيمة الرصيد الممنوح."
            : "Referrer pipeline, settings, and earnings. Commission is calculated on actual amount paid, NOT on credit value granted."}
        </p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {isAr ? "المُحيلون" : "Referrers"}</div>
          <div className="text-2xl font-bold mt-1">{data.totals.totalReferrers}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {isAr ? `لديهم كود: ${data.totals.usersWithCode}` : `With code: ${data.totals.usersWithCode}`}
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {isAr ? "مدعوون" : "Referred users"}</div>
          <div className="text-2xl font-bold mt-1">{data.totals.referredUsers}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {isAr ? "قيد الحجز" : "Pending"}</div>
          <div className="text-2xl font-bold mt-1 text-amber-600">{fmt(data.totals.pendingUsd)}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {isAr ? `متاح: ${fmt(data.totals.availableUsd)}` : `Available: ${fmt(data.totals.availableUsd)}`}
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> {isAr ? "مدفوع" : "Paid out"}</div>
          <div className="text-2xl font-bold mt-1 text-green-600">{fmt(data.totals.paidUsd)}</div>
          {data.totals.reversedUsd > 0 && (
            <div className="text-xs text-red-600 mt-1">
              {isAr ? `معكوس: ${fmt(data.totals.reversedUsd)}` : `Reversed: ${fmt(data.totals.reversedUsd)}`}
            </div>
          )}
        </CardContent></Card>
      </div>

      {/* Settings */}
      <Card>
        <CardHeader>
          <CardTitle>{isAr ? "إعدادات البرنامج" : "Program Settings"}</CardTitle>
          <CardDescription>
            {isAr ? "تطبق على العمولات الجديدة فقط. القديمة لا تتغير." : "Applies to new earnings only. Existing earnings are unaffected."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">{isAr ? "تفعيل البرنامج" : "Enable Program"}</Label>
              <p className="text-sm text-muted-foreground">
                {isAr ? "إذا أُوقف، تتوقف العمولات الجديدة (والقديمة تستمر بالنضوج)." : "If off, no new commissions are recorded (existing ones still ripen)."}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-enabled" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="rate">{isAr ? "نسبة العمولة (%)" : "Commission Rate (%)"}</Label>
              <Input id="rate" type="number" step="0.1" min="0" max="100" value={ratePct} onChange={(e) => setRatePct(e.target.value)} data-testid="input-rate" />
            </div>
            <div>
              <Label htmlFor="hold">{isAr ? "أيام الحجز" : "Hold Days"}</Label>
              <Input id="hold" type="number" min="0" max="365" value={holdDays} onChange={(e) => setHoldDays(e.target.value)} data-testid="input-hold-days" />
            </div>
            <div>
              <Label htmlFor="min">{isAr ? "حد السحب الأدنى ($)" : "Min Redeem ($)"}</Label>
              <Input id="min" type="number" min="0" step="0.01" value={minRedeem} onChange={(e) => setMinRedeem(e.target.value)} data-testid="input-min-redeem" />
            </div>
          </div>
          <Button onClick={saveSettings} disabled={saving} data-testid="button-save-settings">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {isAr ? "حفظ" : "Save"}
          </Button>
        </CardContent>
      </Card>

      {/* Top referrers */}
      <Card>
        <CardHeader>
          <CardTitle>{isAr ? "أفضل المُحيلين" : "Top Referrers"}</CardTitle>
          <CardDescription>{isAr ? "مرتبة بإجمالي العمولات" : "Sorted by lifetime commission"}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.topReferrers.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">{isAr ? "لا يوجد مُحيلون بعد" : "No referrers yet"}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="py-2 pr-2">{isAr ? "المُحيل" : "Referrer"}</th>
                    <th className="py-2 pr-2">{isAr ? "الكود" : "Code"}</th>
                    <th className="py-2 pr-2 text-right">{isAr ? "العدد" : "Count"}</th>
                    <th className="py-2 pr-2 text-right">{isAr ? "معلّق" : "Pending"}</th>
                    <th className="py-2 pr-2 text-right">{isAr ? "متاح" : "Available"}</th>
                    <th className="py-2 pr-2 text-right">{isAr ? "مدفوع" : "Redeemed"}</th>
                    <th className="py-2 pr-2 text-right">{isAr ? "إجمالي" : "Lifetime"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topReferrers.map((r) => (
                    <tr key={r.referrerId} className="border-b last:border-0" data-testid={`row-referrer-${r.referrerId}`}>
                      <td className="py-2 pr-2">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">{r.email}</div>
                      </td>
                      <td className="py-2 pr-2 font-mono text-xs">{r.referralCode ?? "—"}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{r.earningCount}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-amber-600">{fmt(r.pendingUsd)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-green-600">{fmt(r.availableUsd)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{fmt(r.redeemedUsd)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums font-semibold">{fmt(r.lifetimeUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent earnings */}
      <Card>
        <CardHeader>
          <CardTitle>{isAr ? "آخر العمولات" : "Recent Earnings"}</CardTitle>
          <CardDescription>{isAr ? "آخر 100" : "Last 100"}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.recent.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">{isAr ? "لا توجد عمولات بعد" : "No earnings yet"}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="py-2 pr-2">{isAr ? "التاريخ" : "Date"}</th>
                    <th className="py-2 pr-2">{isAr ? "المُحيل" : "Referrer"}</th>
                    <th className="py-2 pr-2">{isAr ? "المُحال" : "Referred"}</th>
                    <th className="py-2 pr-2">{isAr ? "النوع" : "Type"}</th>
                    <th className="py-2 pr-2 text-right">{isAr ? "مبلغ" : "Amount"}</th>
                    <th className="py-2 pr-2 text-right">{isAr ? "عمولة" : "Commission"}</th>
                    <th className="py-2 pr-2">{isAr ? "الحالة" : "Status"}</th>
                    <th className="py-2 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((e) => (
                    <tr key={e.id} className="border-b last:border-0" data-testid={`row-earning-${e.id}`}>
                      <td className="py-2 pr-2 whitespace-nowrap text-xs">{fmtDate(e.createdAt, i18n.language)}</td>
                      <td className="py-2 pr-2 text-xs">{e.referrerEmail}</td>
                      <td className="py-2 pr-2 text-xs">{e.referredEmail}</td>
                      <td className="py-2 pr-2 capitalize">{e.sourceType}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{fmt(e.basisAmountUsd)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums font-medium">{fmt(e.commissionUsd)}</td>
                      <td className="py-2 pr-2">
                        {e.status === "pending"   && <Badge variant="outline" className="text-amber-600 border-amber-300"><Clock className="h-3 w-3 mr-1" />{isAr ? "معلّق" : "Pending"}</Badge>}
                        {e.status === "available" && <Badge className="bg-green-100 text-green-800 border-green-300 hover:bg-green-100"><Wallet className="h-3 w-3 mr-1" />{isAr ? "متاح" : "Available"}</Badge>}
                        {e.status === "redeemed"  && <Badge variant="outline"><CheckCircle2 className="h-3 w-3 mr-1" />{isAr ? "مدفوع" : "Redeemed"}</Badge>}
                        {e.status === "reversed"  && <Badge variant="outline" className="text-red-600 border-red-300"><XCircle className="h-3 w-3 mr-1" />{isAr ? "معكوس" : "Reversed"}</Badge>}
                      </td>
                      <td className="py-2 pr-2">
                        {e.status !== "reversed" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={reversingId === e.id}
                            onClick={() => reverseEarning(e.id)}
                            data-testid={`button-reverse-${e.id}`}
                            title={isAr ? "عكس العمولة" : "Reverse"}
                          >
                            {reversingId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
