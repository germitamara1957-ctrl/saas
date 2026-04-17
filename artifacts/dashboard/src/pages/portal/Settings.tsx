import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useGetPortalMe, getGetPortalMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { authFetch } from "@/lib/authFetch";
import { User, Trash2, AlertTriangle, Tag, Loader2, Wallet, Download, ShieldCheck, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import i18n from "@/i18n";

const deleteSchema = z.object({
  password: z.string().min(1, "Password is required"),
  confirm: z.string(),
}).refine((d) => d.confirm === "DELETE", {
  message: 'Please type "DELETE" to confirm',
  path: ["confirm"],
});

export default function PortalSettings() {
  const { data: me, isLoading } = useGetPortalMe();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const isAr = i18n.language === "ar";
  const queryClient = useQueryClient();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [promoCode, setPromoCode] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);

  // Spending Limits state
  const [dailyLimit, setDailyLimit] = useState<string>("");
  const [monthlyLimit, setMonthlyLimit] = useState<string>("");
  const [alertThreshold, setAlertThreshold] = useState<string>("80");
  const [savingLimits, setSavingLimits] = useState(false);
  const spending = (me as { spending?: { dailySpent: number; monthlySpent: number; dailyLimit: number | null; monthlyLimit: number | null; alertThreshold: number } } | undefined)?.spending;

  // Initialize fields from server when `me` arrives
  useEffect(() => {
    if (spending) {
      setDailyLimit(spending.dailyLimit?.toString() ?? "");
      setMonthlyLimit(spending.monthlyLimit?.toString() ?? "");
      setAlertThreshold(((spending.alertThreshold ?? 0.8) * 100).toString());
    }
  }, [spending?.dailyLimit, spending?.monthlyLimit, spending?.alertThreshold]);

  const saveLimits = async () => {
    setSavingLimits(true);
    try {
      const res = await authFetch("/api/portal/me/spending-limits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyLimit: dailyLimit === "" ? null : Number(dailyLimit),
          monthlyLimit: monthlyLimit === "" ? null : Number(monthlyLimit),
          alertThreshold: Math.min(1, Math.max(0.1, Number(alertThreshold) / 100)),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: t("common.error"), description: data.error, variant: "destructive" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: getGetPortalMeQueryKey() });
      toast({ title: isAr ? "تم حفظ حدود الإنفاق" : "Spending limits saved" });
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    } finally {
      setSavingLimits(false);
    }
  };

  const form = useForm<z.infer<typeof deleteSchema>>({
    resolver: zodResolver(deleteSchema),
    defaultValues: { password: "", confirm: "" },
  });

  const handleDeleteAccount = async ({ password }: z.infer<typeof deleteSchema>) => {
    setIsDeleting(true);
    try {
      const res = await authFetch("/api/portal/auth/account", {
        method: "DELETE",
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Failed to delete account", description: data.error || "Please try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Account deleted", description: "Your account has been permanently deleted." });
      logout();
      navigate("/login", { replace: true });
    } catch {
      toast({ title: "Network error", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const handleRedeem = async () => {
    const code = promoCode.trim().toUpperCase();
    if (!code) return;
    setRedeemLoading(true);
    try {
      const res = await authFetch("/api/portal/promo-codes/redeem", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errKey = data.error as string;
        const errMsg = t(`promoCodes.errors.${errKey}`, { defaultValue: data.error || "Failed to redeem" });
        toast({ title: t("common.error"), description: errMsg, variant: "destructive" });
        return;
      }
      setPromoCode("");
      queryClient.invalidateQueries({ queryKey: getGetPortalMeQueryKey() });
      toast({
        title: t("promoCodes.redeemSuccess", { credits: data.creditsAdded }),
        description: `$${data.newBalance.toFixed(4)}`,
      });
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    } finally {
      setRedeemLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl" dir={isAr ? "rtl" : "ltr"}>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {isAr ? "إعدادات الحساب" : "Account Settings"}
        </h1>
        <p className="text-muted-foreground mt-2">
          {isAr ? "إدارة تفضيلات الحساب والأمان" : "Manage your account preferences and security."}
        </p>
      </div>

      {/* Profile Info */}
      <Card>
        <CardHeader className={`flex flex-row items-center gap-3 space-y-0 ${isAr ? "flex-row-reverse" : ""}`}>
          <div className="p-2 rounded-full bg-primary/10">
            <User className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">{isAr ? "الملف الشخصي" : "Profile"}</CardTitle>
            <CardDescription>{isAr ? "معلومات حسابك" : "Your account information"}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-4 w-40 bg-muted rounded animate-pulse" />
              <div className="h-4 w-56 bg-muted rounded animate-pulse" />
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">{isAr ? "الاسم" : "Name"}</Label>
                <p className="font-medium mt-0.5">{me?.user.name}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{isAr ? "البريد الإلكتروني" : "Email"}</Label>
                <p className="font-medium mt-0.5">{me?.user.email}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{isAr ? "حالة البريد الإلكتروني" : "Email Status"}</Label>
                <p className="mt-0.5">
                  {(me?.user as { emailVerified?: boolean })?.emailVerified ? (
                    <span className="text-emerald-600 font-medium text-sm">{isAr ? "مُحقَّق" : "Verified"}</span>
                  ) : (
                    <span className="text-amber-600 font-medium text-sm">{isAr ? "غير مُحقَّق" : "Not verified"}</span>
                  )}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{isAr ? "عضو منذ" : "Member Since"}</Label>
                <p className="font-medium mt-0.5">
                  {me?.user.createdAt ? new Date(me.user.createdAt).toLocaleDateString() : "—"}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Spending Limits */}
      <Card>
        <CardHeader className={`flex flex-row items-center gap-3 space-y-0 ${isAr ? "flex-row-reverse" : ""}`}>
          <div className="p-2 rounded-full bg-blue-500/10">
            <Wallet className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <CardTitle className="text-base">{isAr ? "حدود الإنفاق" : "Spending Limits"}</CardTitle>
            <CardDescription>
              {isAr
                ? "حدِّد سقفًا يوميًا أو شهريًا لمنع الفواتير المفاجئة"
                : "Cap your daily or monthly spend to prevent surprise charges"}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {spending && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{isAr ? "أُنفق اليوم" : "Spent today"}</p>
                <p className="text-lg font-semibold mt-0.5">${spending.dailySpent.toFixed(4)}</p>
                {spending.dailyLimit != null && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isAr ? "من" : "of"} ${spending.dailyLimit.toFixed(2)}
                  </p>
                )}
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{isAr ? "أُنفق هذا الشهر" : "Spent this month"}</p>
                <p className="text-lg font-semibold mt-0.5">${spending.monthlySpent.toFixed(4)}</p>
                {spending.monthlyLimit != null && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isAr ? "من" : "of"} ${spending.monthlyLimit.toFixed(2)}
                  </p>
                )}
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">{isAr ? "حد يومي ($)" : "Daily limit ($)"}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder={isAr ? "بلا حد" : "No limit"}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">{isAr ? "حد شهري ($)" : "Monthly limit ($)"}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder={isAr ? "بلا حد" : "No limit"}
                value={monthlyLimit}
                onChange={(e) => setMonthlyLimit(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">{isAr ? "عتبة التنبيه (%)" : "Alert threshold (%)"}</Label>
              <Input
                type="number"
                min="10"
                max="100"
                step="1"
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(e.target.value)}
              />
            </div>
          </div>
          <div className={`flex ${isAr ? "justify-start" : "justify-end"}`}>
            <Button onClick={saveLimits} disabled={savingLimits}>
              {savingLimits ? <Loader2 className="h-4 w-4 animate-spin" /> : (isAr ? "حفظ الحدود" : "Save Limits")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Promo Code Redemption */}
      <Card>
        <CardHeader className={`flex flex-row items-center gap-3 space-y-0 ${isAr ? "flex-row-reverse" : ""}`}>
          <div className="p-2 rounded-full bg-emerald-500/10">
            <Tag className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <CardTitle className="text-base">{t("promoCodes.redeemTitle")}</CardTitle>
            <CardDescription>{t("promoCodes.redeemDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className={`flex gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
            <Input
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder={t("promoCodes.redeemPlaceholder")}
              className="font-mono tracking-widest uppercase flex-1"
              onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
              disabled={redeemLoading}
            />
            <Button onClick={handleRedeem} disabled={redeemLoading || !promoCode.trim()}>
              {redeemLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("promoCodes.redeemButton")
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className={`flex flex-row items-center gap-3 space-y-0 ${isAr ? "flex-row-reverse" : ""}`}>
          <div className="p-2 rounded-full bg-muted">
            <Download className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base">{isAr ? "تصدير بياناتي (GDPR)" : "Export My Data (GDPR)"}</CardTitle>
            <CardDescription>
              {isAr
                ? "نزّل أرشيفًا مضغوطًا يحوي ملفك الشخصي، مفاتيح API، الـ webhooks، وآخر 90 يومًا من السجلّات."
                : "Download a ZIP archive with your profile, API keys, webhooks, and the last 90 days of usage logs."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const res = await authFetch("/api/portal/me/export");
                if (!res.ok) throw new Error("Export failed");
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `account-export-${new Date().toISOString().slice(0, 10)}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                toast({ title: isAr ? "تم بدء التنزيل" : "Download started" });
              } catch (e) {
                toast({ title: isAr ? "فشل التصدير" : "Export failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
              }
            }}
          >
            <Download className="h-4 w-4 mr-2" />
            {isAr ? "تنزيل أرشيف ZIP" : "Download ZIP archive"}
          </Button>
        </CardContent>
      </Card>

      <PortalTwoFactorCard isAr={isAr} />

      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader className={`flex flex-row items-center gap-3 space-y-0 ${isAr ? "flex-row-reverse" : ""}`}>
          <div className="p-2 rounded-full bg-destructive/10">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <CardTitle className="text-base text-destructive">
              {isAr ? "منطقة الخطر" : "Danger Zone"}
            </CardTitle>
            <CardDescription>
              {isAr ? "إجراءات لا يمكن التراجع عنها — تصرف بحذر" : "Irreversible actions — proceed with caution"}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className={`flex items-center justify-between p-4 rounded-lg border border-destructive/20 bg-destructive/5 ${isAr ? "flex-row-reverse" : ""}`}>
            <div className={isAr ? "text-right" : ""}>
              <p className="font-medium text-sm">{isAr ? "حذف الحساب" : "Delete Account"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isAr
                  ? "حذف حسابك ومفاتيح API وبيانات الاستخدام بشكل دائم. لا يمكن التراجع عن ذلك."
                  : "Permanently delete your account, all API keys, and usage data. This cannot be undone."}
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              className={`${isAr ? "mr-4" : "ml-4"} shrink-0`}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isAr ? "حذف الحساب" : "Delete Account"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={(o) => { if (!o) { setShowDeleteDialog(false); form.reset(); } }}>
        <AlertDialogContent dir={isAr ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              {isAr ? "حذف الحساب بشكل دائم" : "Delete Account Permanently"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isAr
                ? "سيؤدي ذلك إلى حذف حسابك بشكل دائم وإلغاء جميع مفاتيح API ومسح بياناتك."
                : "This will permanently delete your account, revoke all API keys, and erase your data."}{" "}
              <strong>{isAr ? "لا يمكن التراجع عن هذا الإجراء." : "This action cannot be undone."}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleDeleteAccount)} className="space-y-4 py-2">
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <Label>{isAr ? "أكّد بكلمة المرور" : "Confirm with your password"}</Label>
                  <FormControl>
                    <Input type="password" placeholder={isAr ? "أدخل كلمة المرور" : "Enter your password"} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="confirm" render={({ field }) => (
                <FormItem>
                  <Label>{isAr ? <>اكتب <strong>DELETE</strong> للتأكيد</> : <>Type <strong>DELETE</strong> to confirm</>}</Label>
                  <FormControl>
                    <Input placeholder='Type "DELETE"' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <AlertDialogFooter className={isAr ? "flex-row-reverse" : ""}>
                <AlertDialogCancel type="button" onClick={() => { setShowDeleteDialog(false); form.reset(); }}>
                  {isAr ? "إلغاء" : "Cancel"}
                </AlertDialogCancel>
                <AlertDialogAction
                  type="submit"
                  className="bg-destructive hover:bg-destructive/90"
                  disabled={isDeleting}
                  onClick={(e) => {
                    e.preventDefault();
                    form.handleSubmit(handleDeleteAccount)(e);
                  }}
                >
                  {isDeleting ? (isAr ? "جارٍ الحذف..." : "Deleting…") : (isAr ? "حذف حسابي" : "Delete My Account")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </form>
          </Form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PortalTwoFactorCard({ isAr }: { isAr: boolean }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setupData, setSetupData] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/portal/2fa/status");
        if (!res.ok) { setEnabled(false); return; }
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
      const res = await authFetch("/api/portal/2fa/setup", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed to start 2FA setup");
      setSetupData({ qrDataUrl: d.qrDataUrl, secret: d.secret });
    } catch (e) {
      toast({
        title: isAr ? "تعذّر بدء إعداد التحقّق الثنائي" : "2FA setup failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^[0-9]{6}$/.test(code)) {
      toast({ title: isAr ? "أدخل رمزًا من 6 أرقام" : "Enter the 6-digit code", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/portal/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Verification failed");
      setEnabled(true);
      setSetupData(null);
      setCode("");
      toast({ title: isAr ? "تم تفعيل التحقّق الثنائي" : "Two-factor authentication enabled" });
    } catch (e) {
      toast({
        title: isAr ? "فشل التحقّق" : "Verification failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!/^[0-9]{6}$/.test(code)) {
      toast({ title: isAr ? "أدخل رمزك الحالي من 6 أرقام لإيقاف التحقّق" : "Enter your current 6-digit code to disable", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/portal/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed to disable");
      setEnabled(false);
      setCode("");
      toast({ title: isAr ? "تم إيقاف التحقّق الثنائي" : "Two-factor authentication disabled" });
    } catch (e) {
      toast({
        title: isAr ? "تعذّر إيقاف التحقّق الثنائي" : "Failed to disable 2FA",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className={`flex flex-row items-center gap-3 space-y-0 ${isAr ? "flex-row-reverse" : ""}`}>
        <div className="p-2 rounded-full bg-primary/10">
          <ShieldCheck className="h-4 w-4 text-primary" />
        </div>
        <div>
          <CardTitle className="text-base">
            {isAr ? "التحقّق الثنائي (TOTP)" : "Two-Factor Authentication (TOTP)"}
          </CardTitle>
          <CardDescription>
            {isAr
              ? "أضِف طبقة حماية ثانية باستخدام تطبيق Google Authenticator أو 1Password أو Authy."
              : "Add a second factor (Google Authenticator, 1Password, Authy) to your account login."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {enabled === null ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : enabled ? (
          <>
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium text-sm">
                {isAr ? "التحقّق الثنائي مُفعَّل على هذا الحساب." : "2FA is enabled on this account."}
              </span>
            </div>
            <div className="space-y-2 max-w-sm">
              <Label>
                {isAr ? "إيقاف التحقّق الثنائي — أدخل الرمز الحالي" : "Disable 2FA — enter current 6-digit code"}
              </Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
              />
              <Button variant="destructive" onClick={disable} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {isAr ? "إيقاف التحقّق الثنائي" : "Disable 2FA"}
              </Button>
            </div>
          </>
        ) : setupData ? (
          <>
            <p className="text-sm">
              {isAr
                ? "امسح رمز QR بتطبيق المصادقة لديك ثم أدخل الرمز المكوّن من 6 أرقام للتأكيد."
                : "Scan this QR code with your authenticator app, then enter the 6-digit code to confirm."}
            </p>
            <img src={setupData.qrDataUrl} alt="TOTP QR code" className="border rounded-md p-2 bg-white" width={220} height={220} />
            <p className="text-xs text-muted-foreground">
              {isAr ? "أو أدخل هذا السر يدويًا:" : "Or enter this secret manually:"}{" "}
              <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">{setupData.secret}</code>
            </p>
            <div className="space-y-2 max-w-sm">
              <Label>{isAr ? "رمز التحقّق" : "Verification code"}</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
              />
              <div className="flex gap-2">
                <Button onClick={verify} disabled={busy || code.length !== 6}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  {isAr ? "تحقّق وفعِّل" : "Verify & Enable"}
                </Button>
                <Button variant="outline" onClick={() => { setSetupData(null); setCode(""); }} disabled={busy}>
                  {isAr ? "إلغاء" : "Cancel"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <Button onClick={beginSetup} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
            {isAr ? "تفعيل التحقّق الثنائي" : "Enable 2FA"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
