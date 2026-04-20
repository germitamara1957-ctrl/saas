import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Copy, CheckCircle2, Clock, XCircle, Wallet, Users, MessageCircle, Share2, Gift } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authFetch";

interface ReferralEarning {
  id: number;
  sourceType: "topup" | "plan";
  basisAmountUsd: number;
  commissionUsd: number;
  status: "pending" | "available" | "redeemed" | "reversed";
  unlocksAt: string;
  redeemedAt: string | null;
  createdAt: string;
}

interface ReferralData {
  enabled: boolean;
  code: string;
  link: string | null;
  rate: number;
  holdDays: number;
  minRedeemUsd: number;
  emailVerified?: boolean;
  stats: {
    referredCount: number;
    pendingUsd: number;
    availableUsd: number;
    redeemedUsd: number;
    reversedUsd: number;
    lifetimeUsd: number;
  };
  recent: ReferralEarning[];
}

function fmtUsd(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function fmtDate(s: string, lang: string): string {
  try {
    return new Date(s).toLocaleDateString(lang === "ar" ? "ar-DZ" : "en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return s; }
}

export default function PortalReferrals() {
  const { t: _t } = useTranslation();
  const { toast } = useToast();
  const isAr = i18n.language === "ar";

  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(false);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/portal/referrals");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as ReferralData);
    } catch (err) {
      toast({
        title: isAr ? "تعذّر تحميل بيانات الإحالة" : "Failed to load referrals",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const copy = async (text: string, kind: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
      toast({ title: isAr ? "تم النسخ" : "Copied" });
    } catch {
      toast({ title: isAr ? "فشل النسخ" : "Copy failed", variant: "destructive" });
    }
  };

  const handleRedeem = async () => {
    setRedeeming(true);
    try {
      const res = await authFetch("/api/portal/referrals/redeem", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: isAr ? "فشلت عملية التحويل" : "Redeem failed",
          description: body?.error ?? `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: isAr ? "تمت إضافة الرصيد" : "Credit added",
        description: isAr
          ? `تمت إضافة ${fmtUsd(body.redeemedUsd)} إلى رصيد الشحن.`
          : `${fmtUsd(body.redeemedUsd)} added to your top-up balance.`,
      });
      await load();
    } catch (err) {
      toast({
        title: isAr ? "خطأ في الاتصال" : "Network error",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setRedeeming(false);
    }
  };

  const shareWhatsApp = () => {
    if (!data?.link) return;
    const msg = isAr
      ? `جرّب AI Gateway للوصول إلى Gemini وImagen وVeo بأسعار رخيصة جداً 👇\n${data.link}`
      : `Try AI Gateway to access Gemini, Imagen, and Veo at the lowest prices 👇\n${data.link}`;
    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const shareNative = async () => {
    if (!data?.link) return;
    const shareData = {
      title: "AI Gateway",
      text: isAr ? "انضم إلي على AI Gateway" : "Join me on AI Gateway",
      url: data.link,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await copy(data.link, "link");
      }
    } catch { /* user cancelled */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]" dir={isAr ? "rtl" : "ltr"}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const ratePct = (data.rate * 100).toFixed(0);

  if (!data.enabled) {
    return (
      <div className="space-y-6 max-w-3xl" dir={isAr ? "rtl" : "ltr"}>
        <h1 className="text-3xl font-bold tracking-tight">
          {isAr ? "برنامج الإحالة" : "Referral Program"}
        </h1>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {isAr
              ? "برنامج الإحالة غير متاح حالياً. تواصل مع الدعم لمزيد من المعلومات."
              : "The referral program is currently unavailable. Contact support for more information."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={isAr ? "rtl" : "ltr"}>
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Gift className="h-7 w-7 text-primary" />
          {isAr ? "برنامج الإحالة" : "Referral Program"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {isAr
            ? `اربح ${ratePct}% من قيمة كل دفعة حقيقية يقوم بها من تدعوهم. (يُحسب من المبلغ المدفوع، لا من الرصيد الممنوح.)`
            : `Earn ${ratePct}% of every real payment your invitees make. (Calculated on amount paid, not credit granted.)`}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {isAr ? "المُحالون" : "Referred"}</div>
            <div className="text-2xl font-bold mt-1" data-testid="stat-referred-count">{data.stats.referredCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {isAr ? "قيد الانتظار" : "Pending"}</div>
            <div className="text-2xl font-bold mt-1 text-amber-600" data-testid="stat-pending-usd">{fmtUsd(data.stats.pendingUsd)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {isAr ? `يُفرَج عنها بعد ${data.holdDays} يوماً` : `Released after ${data.holdDays} days`}
            </div>
          </CardContent>
        </Card>
        <Card className="border-primary/30">
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> {isAr ? "متاح للسحب" : "Available"}</div>
            <div className="text-2xl font-bold mt-1 text-green-600" data-testid="stat-available-usd">{fmtUsd(data.stats.availableUsd)}</div>
            <Button
              size="sm"
              className="w-full mt-2"
              disabled={
                redeeming ||
                data.stats.availableUsd < data.minRedeemUsd ||
                data.emailVerified === false
              }
              onClick={handleRedeem}
              data-testid="button-redeem"
            >
              {redeeming
                ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> {isAr ? "جارٍ..." : "Processing..."}</>
                : (isAr ? "تحويل للرصيد" : "Redeem")}
            </Button>
            {data.emailVerified === false && (
              <div className="text-xs text-amber-600 dark:text-amber-500 mt-1" data-testid="text-verify-required">
                {isAr
                  ? "يجب توثيق بريدك الإلكتروني قبل السحب."
                  : "Verify your email to redeem."}
              </div>
            )}
            {data.emailVerified !== false && data.stats.availableUsd > 0 && data.stats.availableUsd < data.minRedeemUsd && (
              <div className="text-xs text-muted-foreground mt-1">
                {isAr
                  ? `الحد الأدنى ${fmtUsd(data.minRedeemUsd)}`
                  : `Min ${fmtUsd(data.minRedeemUsd)}`}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> {isAr ? "إجمالي مدى الحياة" : "Lifetime"}</div>
            <div className="text-2xl font-bold mt-1" data-testid="stat-lifetime-usd">{fmtUsd(data.stats.lifetimeUsd)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {isAr ? `مُحوَّل: ${fmtUsd(data.stats.redeemedUsd)}` : `Redeemed: ${fmtUsd(data.stats.redeemedUsd)}`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Share card */}
      <Card>
        <CardHeader>
          <CardTitle>{isAr ? "كود الإحالة الخاص بك" : "Your Referral Code"}</CardTitle>
          <CardDescription>
            {isAr
              ? "شارك هذا الرابط مع المطوّرين والشركات. يحصلون على أسعار رخيصة، وتحصل أنت على عمولة."
              : "Share this link with developers and businesses. They get great pricing, you earn commission."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">{isAr ? "الكود" : "Code"}</label>
            <div className="flex gap-2">
              <Input value={data.code} readOnly className="font-mono text-lg tracking-widest" data-testid="input-referral-code" />
              <Button variant="outline" onClick={() => copy(data.code, "code")} data-testid="button-copy-code">
                {copied === "code" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{isAr ? "رابط الإحالة" : "Share Link"}</label>
            <div className="flex gap-2">
              <Input value={data.link ?? ""} readOnly data-testid="input-referral-link" />
              <Button variant="outline" onClick={() => data.link && copy(data.link, "link")} data-testid="button-copy-link">
                {copied === "link" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={shareWhatsApp} className="bg-[#25D366] hover:bg-[#1ebe5d] text-white border-0" data-testid="button-share-whatsapp">
              <MessageCircle className="h-4 w-4 mr-2" /> WhatsApp
            </Button>
            <Button variant="outline" onClick={shareNative} data-testid="button-share-native">
              <Share2 className="h-4 w-4 mr-2" /> {isAr ? "مشاركة" : "Share"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle>{isAr ? "سجل العمولات" : "Earnings History"}</CardTitle>
          <CardDescription>
            {isAr ? "آخر 20 عملية" : "Last 20 entries"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.recent.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              {isAr
                ? "لا توجد عمولات بعد. ادعُ أصدقاءك ليبدأ الكسب!"
                : "No earnings yet. Invite friends to start earning!"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="py-2 pr-2">{isAr ? "التاريخ" : "Date"}</th>
                    <th className="py-2 pr-2">{isAr ? "النوع" : "Source"}</th>
                    <th className="py-2 pr-2 text-right">{isAr ? "المبلغ المدفوع" : "Amount Paid"}</th>
                    <th className="py-2 pr-2 text-right">{isAr ? "العمولة" : "Commission"}</th>
                    <th className="py-2 pr-2">{isAr ? "الحالة" : "Status"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((e) => (
                    <tr key={e.id} className="border-b last:border-0" data-testid={`row-earning-${e.id}`}>
                      <td className="py-2 pr-2 whitespace-nowrap">{fmtDate(e.createdAt, i18n.language)}</td>
                      <td className="py-2 pr-2 capitalize">{e.sourceType}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{fmtUsd(e.basisAmountUsd)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums font-medium">{fmtUsd(e.commissionUsd)}</td>
                      <td className="py-2 pr-2">
                        {e.status === "pending" && (
                          <Badge variant="outline" className="text-amber-600 border-amber-300">
                            <Clock className="h-3 w-3 mr-1" />
                            {isAr ? `ينضج ${fmtDate(e.unlocksAt, i18n.language)}` : `Ripe ${fmtDate(e.unlocksAt, i18n.language)}`}
                          </Badge>
                        )}
                        {e.status === "available" && (
                          <Badge className="bg-green-100 text-green-800 border-green-300 hover:bg-green-100">
                            <Wallet className="h-3 w-3 mr-1" />{isAr ? "متاح" : "Available"}
                          </Badge>
                        )}
                        {e.status === "redeemed" && (
                          <Badge variant="outline">
                            <CheckCircle2 className="h-3 w-3 mr-1" />{isAr ? "محوَّل" : "Redeemed"}
                          </Badge>
                        )}
                        {e.status === "reversed" && (
                          <Badge variant="outline" className="text-red-600 border-red-300">
                            <XCircle className="h-3 w-3 mr-1" />{isAr ? "مسترَد" : "Reversed"}
                          </Badge>
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
