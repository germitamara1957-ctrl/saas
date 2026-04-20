import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Terminal, CheckCircle2, AlertCircle, ShieldCheck } from "lucide-react";
import i18n from "@/i18n";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.1l6.6 4.8C14.7 15 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.1z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C40.6 35.4 44 30.1 44 24c0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}

// Direct fetch is used (instead of the generated `usePortalLogin`) because the
// generated `LoginRequest` schema only declares `email` + `password`. The 2FA
// gate adds an optional `totpCode` field that is not in the OpenAPI spec yet.
async function portalLoginRequest(body: { email: string; password: string; totpCode?: string }) {
  const res = await fetch("/api/portal/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default function PortalLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const isAr = i18n.language === "ar";
  const [submitting, setSubmitting] = useState(false);
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  const verifiedStatus = searchParams.get("verified");
  const verifiedReason = searchParams.get("reason");
  const googleStatus = searchParams.get("google");
  const googleReason = searchParams.get("reason");

  const [googleEnabled, setGoogleEnabled] = useState(false);
  useEffect(() => {
    fetch(`${API_BASE}/api/portal/auth/google/config`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() as Promise<{ enabled: boolean }> : { enabled: false }))
      .then((d) => setGoogleEnabled(Boolean(d?.enabled)))
      .catch(() => setGoogleEnabled(false));
  }, []);

  const startGoogleSignIn = () => {
    window.location.href = `${API_BASE}/api/portal/auth/google`;
  };

  const googleErrorText = (() => {
    if (googleStatus !== "error") return null;
    if (googleReason === "cancelled") return isAr ? "تم إلغاء تسجيل الدخول عبر Google." : "Google sign-in was cancelled.";
    if (googleReason === "email_not_verified") return isAr ? "حساب Google غير مُحقّق البريد." : "Your Google email is not verified.";
    if (googleReason === "account_disabled") return isAr ? "هذا الحساب معطّل. تواصل مع الدعم." : "This account is disabled. Contact support.";
    if (googleReason === "too_many_signups") return isAr ? "تم تجاوز الحد المسموح به لإنشاء الحسابات من هذا العنوان. حاول لاحقاً." : "Too many accounts have been created from this address. Please try again later.";
    if (googleReason === "link_blocked_unverified") return isAr ? "يوجد حساب بنفس البريد لكنه غير مُحقّق. سجّل دخولاً بكلمة المرور وحقّق البريد أولاً." : "An unverified account exists with this email. Sign in with your password and verify it first.";
    return isAr ? "تعذّر تسجيل الدخول عبر Google. حاول مجدداً." : "Google sign-in failed. Please try again.";
  })();

  const loginSchema = z.object({
    email: z.string().email(isAr ? "أدخل بريداً إلكترونياً صحيحاً" : "Please enter a valid email address"),
    password: z.string().min(1, isAr ? "كلمة المرور مطلوبة" : "Password is required"),
  });

  useEffect(() => {
    if (isAuthenticated && user?.role === "developer") {
      navigate("/portal", { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: z.infer<typeof loginSchema>) => {
    setSubmitting(true);
    try {
      const body: { email: string; password: string; totpCode?: string } = {
        email: data.email,
        password: data.password,
      };
      if (totpRequired) {
        if (!/^\d{6}$/.test(totpCode)) {
          toast({
            title: isAr ? "أدخل رمزًا من 6 أرقام" : "Enter the 6-digit code",
            variant: "destructive",
          });
          return;
        }
        body.totpCode = totpCode;
      }

      const { ok, status, data: res } = await portalLoginRequest(body);
      if (ok && res?.user) {
        login(res.user);
        return;
      }
      // Backend signals "password OK, now provide TOTP" with 401 + totpRequired:true
      if (status === 401 && (res as { totpRequired?: boolean })?.totpRequired) {
        setTotpRequired(true);
        if (totpRequired) {
          // Already on the TOTP step → invalid code
          toast({
            title: isAr ? "رمز التحقّق غير صحيح" : "Invalid 2FA code",
            variant: "destructive",
          });
        } else {
          toast({
            title: isAr ? "أدخل رمز التحقّق الثنائي" : "Enter your 2FA code",
            description: isAr
              ? "افتح تطبيق المصادقة وأدخل الرمز المكوّن من 6 أرقام."
              : "Open your authenticator app and enter the 6-digit code.",
          });
        }
        return;
      }
      toast({
        title: t("auth.signInFailed"),
        description: (res as { error?: string })?.error || t("auth.invalidCredentials"),
        variant: "destructive",
      });
    } catch (err) {
      toast({
        title: t("auth.signInFailed"),
        description: err instanceof Error ? err.message : t("auth.invalidCredentials"),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/40 p-4" dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-8 flex flex-col items-center">
        <div className="bg-primary/10 p-3 rounded-full mb-4">
          <Terminal className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">AI Gateway</h1>
        <p className="text-muted-foreground mt-2">{t("portal.title")}</p>
      </div>

      {verifiedStatus === "success" && (
        <div className="w-full max-w-md mb-4 flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">{isAr ? "تم التحقق من بريدك الإلكتروني!" : "Email verified!"}</p>
            <p className="text-xs opacity-80">{isAr ? "يمكنك الآن تسجيل الدخول." : "You can now sign in to your account."}</p>
          </div>
        </div>
      )}
      {verifiedStatus === "already" && (
        <div className="w-full max-w-md mb-4 flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
          <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">{isAr ? "البريد الإلكتروني محقق مسبقاً" : "Email already verified"}</p>
            <p className="text-xs opacity-80">{isAr ? "حسابك نشط. سجّل الدخول للمتابعة." : "Your account is active. Sign in to continue."}</p>
          </div>
        </div>
      )}
      {verifiedStatus === "error" && (
        <div className="w-full max-w-md mb-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">
              {verifiedReason === "expired"
                ? (isAr ? "انتهت صلاحية رابط التفعيل" : "Verification link expired")
                : (isAr ? "رابط التفعيل غير صالح" : "Invalid verification link")}
            </p>
            <p className="text-xs opacity-80">{isAr ? "اطلب رابطاً جديداً من صفحة تسجيل الدخول." : "Request a new verification link from the sign-in page."}</p>
          </div>
        </div>
      )}

      {googleErrorText && (
        <div className="w-full max-w-md mb-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
          <p>{googleErrorText}</p>
        </div>
      )}

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("auth.developerSignIn")}</CardTitle>
          <CardDescription>{t("auth.developerSignInDesc")}</CardDescription>
        </CardHeader>
        {googleEnabled && (
          <CardContent className="pb-0 space-y-3">
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={startGoogleSignIn}
              data-testid="button-google-signin"
            >
              <GoogleIcon />
              {isAr ? "المتابعة باستخدام Google" : "Continue with Google"}
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              <span>{isAr ? "أو" : "OR"}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </CardContent>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <Label>{t("auth.email")}</Label>
                  <FormControl>
                    <Input placeholder="developer@example.com" type="email" {...field} data-testid="input-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <Label>{t("auth.password")}</Label>
                  <FormControl>
                    <Input placeholder="••••••••" type="password" {...field} data-testid="input-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              {totpRequired && (
                <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    {isAr ? "رمز التحقّق الثنائي (6 أرقام)" : "Two-factor code (6 digits)"}
                  </div>
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    placeholder="123456"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    data-testid="input-totp"
                  />
                  <p className="text-xs text-muted-foreground">
                    {isAr
                      ? "افتح تطبيق المصادقة وأدخل الرمز الحالي."
                      : "Open your authenticator app and enter the current code."}
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={submitting} data-testid="button-submit">
                {submitting
                  ? (isAr ? "جارٍ الدخول..." : "Signing in...")
                  : totpRequired
                    ? (isAr ? "تحقّق وادخل" : "Verify & Sign In")
                    : t("auth.signIn")}
              </Button>
              <div className="flex items-center justify-between w-full text-sm text-muted-foreground">
                <Link to="/forgot-password" className="text-primary hover:underline font-medium">
                  {t("auth.forgotPassword")}
                </Link>
                <span>
                  {t("auth.noAccount")}{" "}
                  <Link to="/signup" className="text-primary hover:underline font-medium">
                    {t("auth.signUp")}
                  </Link>
                </span>
              </div>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
