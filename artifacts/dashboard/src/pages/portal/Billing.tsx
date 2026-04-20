import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Wallet, ExternalLink, AlertCircle, CheckCircle2, XCircle, Clock, MessageCircle, PauseCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authFetch";

interface BillingConfig {
  dzdToUsdRate: number;
  minTopupDzd: number;
  maxTopupDzd: number;
  mode: "test" | "live";
  currency: string;
  enabled: boolean;
}

interface PaymentIntent {
  id: number;
  chargilyCheckoutId: string;
  amountDzd: number;
  amountUsd: number;
  exchangeRate: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "canceled" | "expired";
  mode: "test" | "live";
  checkoutUrl: string | null;
  creditedAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

const STATUS_BADGE: Record<PaymentIntent["status"], { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode; labelEn: string; labelAr: string }> = {
  pending:  { variant: "secondary",   icon: <Clock className="h-3 w-3" />,         labelEn: "Pending",  labelAr: "قيد الانتظار" },
  paid:     { variant: "default",     icon: <CheckCircle2 className="h-3 w-3" />,  labelEn: "Paid",     labelAr: "تم الدفع" },
  failed:   { variant: "destructive", icon: <XCircle className="h-3 w-3" />,       labelEn: "Failed",   labelAr: "فشل" },
  canceled: { variant: "outline",     icon: <XCircle className="h-3 w-3" />,       labelEn: "Canceled", labelAr: "ملغى" },
  expired:  { variant: "outline",     icon: <XCircle className="h-3 w-3" />,       labelEn: "Expired",  labelAr: "منتهٍ" },
};

export default function PortalBilling() {
  const { t } = useTranslation();
  const isAr = i18n.language === "ar";
  const { toast } = useToast();

  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [intents, setIntents] = useState<PaymentIntent[] | null>(null);
  const [amountStr, setAmountStr] = useState("1000");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfgRes, intentsRes] = await Promise.all([
          authFetch("/api/portal/billing/config"),
          authFetch("/api/portal/billing/intents"),
        ]);
        if (!cfgRes.ok) throw new Error(`Config HTTP ${cfgRes.status}`);
        if (!intentsRes.ok) throw new Error(`Intents HTTP ${intentsRes.status}`);
        const cfg = (await cfgRes.json()) as BillingConfig;
        const list = (await intentsRes.json()) as PaymentIntent[];
        if (!cancelled) {
          setConfig(cfg);
          setIntents(list);
          setAmountStr(String(cfg.minTopupDzd >= 1000 ? cfg.minTopupDzd : 1000));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const amount = Number(amountStr);
  const previewUsd = useMemo(() => {
    if (!config || !Number.isFinite(amount) || amount <= 0) return 0;
    return amount / config.dzdToUsdRate;
  }, [amount, config]);

  const validationError = useMemo(() => {
    if (!config) return null;
    if (!Number.isFinite(amount) || amount <= 0) return isAr ? "أدخل مبلغاً صحيحاً" : "Enter a valid amount";
    if (amount < config.minTopupDzd) return (isAr ? "الحد الأدنى: " : "Minimum: ") + config.minTopupDzd + " DZD";
    if (amount > config.maxTopupDzd) return (isAr ? "الحد الأقصى: " : "Maximum: ") + config.maxTopupDzd + " DZD";
    return null;
  }, [amount, config, isAr]);

  async function handleTopup() {
    if (validationError || !config) return;
    setSubmitting(true);
    try {
      const res = await authFetch("/api/portal/billing/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountDzd: Math.round(amount) }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast({ title: isAr ? "فشلت العملية" : "Top-up failed", description: body?.error ?? `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      // Redirect the browser to the Chargily-hosted checkout.
      if (typeof body.checkoutUrl === "string") {
        window.location.assign(body.checkoutUrl);
      }
    } catch (err) {
      toast({ title: isAr ? "خطأ في الاتصال" : "Network error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !config) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>{error ?? (isAr ? "تعذر تحميل الإعدادات" : "Failed to load billing config")}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`space-y-6 ${isAr ? "text-right" : ""}`} dir={isAr ? "rtl" : "ltr"}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Wallet className="h-6 w-6" />
          {isAr ? "شحن الرصيد" : "Top up Credits"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {isAr
            ? "ادفع بالدينار الجزائري عبر Chargily Pay وسيُضاف الرصيد إلى حسابك بالدولار الأمريكي."
            : "Pay in Algerian Dinars via Chargily Pay — credits are added to your account in USD."}
        </p>
        {config.mode === "test" && (
          <Badge variant="outline" className="mt-2 border-amber-500 text-amber-600">
            {isAr ? "وضع الاختبار" : "Test mode"}
          </Badge>
        )}
      </div>

      {config.enabled ? (
        <Card>
          <CardHeader>
            <CardTitle>{isAr ? "إنشاء عملية دفع" : "New Top-up"}</CardTitle>
            <CardDescription>
              {isAr ? "سعر الصرف الحالي:" : "Current rate:"} 1 USD = {config.dzdToUsdRate} DZD
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{isAr ? "المبلغ بالدينار الجزائري (DZD)" : "Amount (DZD)"}</label>
              <Input
                type="number"
                min={config.minTopupDzd}
                max={config.maxTopupDzd}
                step={100}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                dir="ltr"
                className="text-lg font-mono"
              />
              <div className="text-xs text-muted-foreground">
                {isAr ? "الحد الأدنى" : "Min"}: {config.minTopupDzd} DZD · {isAr ? "الحد الأقصى" : "Max"}: {config.maxTopupDzd.toLocaleString()} DZD
              </div>
            </div>

            <div className="rounded-md bg-muted/50 p-4 border">
              <div className="text-sm text-muted-foreground">{isAr ? "ستحصل على" : "You will receive"}</div>
              <div className="text-2xl font-bold tabular-nums" dir="ltr">
                ${previewUsd.toFixed(4)} <span className="text-base text-muted-foreground font-normal">USD</span>
              </div>
            </div>

            {validationError && (
              <div className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-4 w-4" /> {validationError}
              </div>
            )}

            <Button
              className="w-full"
              disabled={submitting || Boolean(validationError)}
              onClick={handleTopup}
              data-testid="button-pay-chargily"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ExternalLink className="h-4 w-4 mr-2" />}
              {isAr ? "ادفع عبر Chargily" : "Pay with Chargily"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <PauseCircle className="h-5 w-5" />
              {isAr ? "خدمة الشحن متوقفة مؤقتاً" : "Top-ups are temporarily paused"}
            </CardTitle>
            <CardDescription>
              {isAr
                ? "الدفع الإلكتروني عبر Chargily Pay متوقف حالياً من قِبَل الإدارة. يمكنك التواصل معنا مباشرة عبر واتساب لإتمام عملية الشحن يدوياً."
                : "Online payment via Chargily Pay is currently disabled by the administrator. Please contact us directly on WhatsApp to top up your account manually."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              asChild
              className="w-full bg-[#25D366] hover:bg-[#1ebe5d] text-white border-0"
              data-testid="button-contact-whatsapp"
            >
              <a
                href={`https://wa.me/213796586479?text=${encodeURIComponent(
                  isAr
                    ? "مرحباً، أرغب في شحن رصيد حسابي على AI Gateway."
                    : "Hello, I'd like to top up my AI Gateway account."
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="h-4 w-4 mr-2" />
                {isAr ? "تواصل عبر واتساب" : "Contact via WhatsApp"}
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isAr ? "سجل المعاملات" : "Transaction history"}</CardTitle>
        </CardHeader>
        <CardContent>
          {!intents || intents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {isAr ? "لا توجد معاملات بعد" : "No transactions yet"}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className={`py-2 ${isAr ? "text-right" : "text-left"}`}>{isAr ? "التاريخ" : "Date"}</th>
                    <th className={`py-2 ${isAr ? "text-right" : "text-left"}`}>DZD</th>
                    <th className={`py-2 ${isAr ? "text-right" : "text-left"}`}>USD</th>
                    <th className={`py-2 ${isAr ? "text-right" : "text-left"}`}>{isAr ? "الحالة" : "Status"}</th>
                    <th className={`py-2 ${isAr ? "text-right" : "text-left"}`}></th>
                  </tr>
                </thead>
                <tbody>
                  {intents.map((it) => {
                    const meta = STATUS_BADGE[it.status];
                    return (
                      <tr key={it.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-3 font-mono text-xs" dir="ltr">{new Date(it.createdAt).toLocaleString(isAr ? "ar" : "en")}</td>
                        <td className="py-3 tabular-nums" dir="ltr">{it.amountDzd.toLocaleString()}</td>
                        <td className="py-3 tabular-nums" dir="ltr">${Number(it.amountUsd).toFixed(4)}</td>
                        <td className="py-3">
                          <Badge variant={meta.variant} className="gap-1">
                            {meta.icon}
                            {isAr ? meta.labelAr : meta.labelEn}
                          </Badge>
                        </td>
                        <td className="py-3">
                          {it.status === "pending" && it.checkoutUrl && (
                            <a href={it.checkoutUrl} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                              {isAr ? "إكمال" : "Resume"} <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
