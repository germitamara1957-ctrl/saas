import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { usePortalRegister } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Copy, CheckCircle2, AlertCircle, Zap, ShieldCheck } from "lucide-react";
import i18n from "@/i18n";

interface ApiKeyPayload {
  keyPrefix: string;
  fullKey: string;
  creditBalance: number;
  planName: string;
}

const REF_STORAGE_KEY = "ai_gw_ref_code";
const REF_STORAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function readStoredRef(): string | null {
  try {
    const raw = localStorage.getItem(REF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code: string; savedAt: number };
    if (!parsed?.code || Date.now() - parsed.savedAt > REF_STORAGE_TTL_MS) {
      localStorage.removeItem(REF_STORAGE_KEY);
      return null;
    }
    return parsed.code;
  } catch {
    return null;
  }
}

export default function PortalSignup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const register = usePortalRegister();
  const isAr = i18n.language === "ar";

  // Capture ?ref=CODE on mount and persist it for 30 days so the user can
  // browse other pages (Plans, Pricing) before signing up.
  const refFromUrl = useMemo(() => searchParams.get("ref"), [searchParams]);
  useEffect(() => {
    if (refFromUrl) {
      try {
        localStorage.setItem(REF_STORAGE_KEY, JSON.stringify({ code: refFromUrl, savedAt: Date.now() }));
      } catch { /* localStorage might be disabled */ }
    }
  }, [refFromUrl]);
  const activeRefCode = refFromUrl ?? readStoredRef();

  const signupSchema = z.object({
    name: z.string().min(2, isAr ? "الاسم يجب أن يكون حرفين على الأقل" : "Name must be at least 2 characters"),
    email: z.string().email(isAr ? "أدخل بريداً إلكترونياً صحيحاً" : "Please enter a valid email address"),
    password: z.string().min(8, t("auth.passwordMin")),
    confirmPassword: z.string(),
  }).refine((d) => d.password === d.confirmPassword, {
    message: t("auth.passwordMismatch"),
    path: ["confirmPassword"],
  });

  type SignupForm = z.infer<typeof signupSchema>;

  const [pendingUser, setPendingUser] = useState<import("@/lib/auth").AuthUser | null>(null);
  const [apiKeyInfo, setApiKeyInfo] = useState<ApiKeyPayload | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isAuthenticated && user?.role === "developer") {
      navigate("/portal", { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  const form = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const copyKey = () => {
    if (!apiKeyInfo) return;
    navigator.clipboard.writeText(apiKeyInfo.fullKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: isAr ? "تم نسخ المفتاح — احفظه بأمان!" : "API key copied — store it safely!" });
  };

  const handleKeyDialogClose = () => {
    if (pendingUser) {
      login(pendingUser);
    }
  };

  const onSubmit = ({ name, email, password }: SignupForm) => {
    register.mutate(
      // refCode is sent loosely — backend treats it as optional, validates,
      // and silently ignores invalid/self-referral codes.
      { data: { name, email, password, ...(activeRefCode ? { refCode: activeRefCode } : {}) } as never },
      {
        onSuccess: (res) => {
          try { localStorage.removeItem(REF_STORAGE_KEY); } catch { /* ignore */ }
          const payload = (res as typeof res & { apiKey?: ApiKeyPayload }).apiKey;
          if (payload) {
            setPendingUser(res.user);
            setApiKeyInfo(payload);
          } else {
            login(res.user);
            toast({ title: t("auth.registered"), description: isAr ? "مرحباً بك في AI Gateway." : "Welcome to AI Gateway." });
          }
        },
        onError: (error) => {
          toast({
            title: t("auth.registerFailed"),
            description: error.message || (isAr ? "حدث خطأ. يرجى المحاولة مجدداً." : "Something went wrong. Please try again."),
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/40 p-4" dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-8 flex flex-col items-center">
        <div className="bg-primary/10 p-3 rounded-full mb-4">
          <Zap className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">AI Gateway</h1>
        <p className="text-muted-foreground mt-2">{t("auth.createAccountDesc")}</p>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("auth.createAccount")}</CardTitle>
          <CardDescription>
            {isAr ? "ابدأ باستخدام Gemini وImagen وVeo في دقائق." : "Start using Gemini, Imagen, and Veo APIs in minutes."}
          </CardDescription>
          {activeRefCode && (
            <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              <span>
                {isAr
                  ? <>تمت دعوتك بكود إحالة <code className="font-mono font-semibold">{activeRefCode}</code></>
                  : <>You were invited with referral code <code className="font-mono font-semibold">{activeRefCode}</code></>}
              </span>
            </div>
          )}
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <Label>{t("auth.fullName")}</Label>
                  <FormControl>
                    <Input placeholder={isAr ? "محمد أحمد" : "John Doe"} {...field} data-testid="input-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <Label>{t("auth.email")}</Label>
                  <FormControl>
                    <Input placeholder="you@example.com" type="email" {...field} data-testid="input-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <Label>{t("auth.password")}</Label>
                  <FormControl>
                    <Input placeholder={isAr ? "٨ أحرف على الأقل" : "Min. 8 characters"} type="password" {...field} data-testid="input-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                <FormItem>
                  <Label>{t("auth.confirmPassword")}</Label>
                  <FormControl>
                    <Input placeholder={isAr ? "أعد إدخال كلمة المرور" : "Repeat your password"} type="password" {...field} data-testid="input-confirm-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={register.isPending} data-testid="button-submit">
                {register.isPending
                  ? (isAr ? "جارٍ إنشاء الحساب..." : "Creating account...")
                  : t("auth.createAccount")}
              </Button>
              <p className="text-sm text-center text-muted-foreground">
                {t("auth.haveAccount")}{" "}
                <Link to="/login" className="text-primary hover:underline font-medium">
                  {t("auth.signIn")}
                </Link>
              </p>
            </CardFooter>
          </form>
        </Form>
      </Card>

      {/* API Key reveal dialog — shown once after registration */}
      <AlertDialog open={!!apiKeyInfo} onOpenChange={(open) => { if (!open) handleKeyDialogClose(); }}>
        <AlertDialogContent className="max-w-lg" dir={isAr ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-500">
              <CheckCircle2 className="h-5 w-5" />
              {isAr ? "تم إنشاء الحساب — إليك مفتاح API" : "Account created — here's your API key"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isAr
                ? <>تم تسجيلك في خطة <span className="font-semibold text-foreground">{apiKeyInfo?.planName}</span> برصيد <span className="font-semibold text-foreground">${apiKeyInfo?.creditBalance}</span>. انسخ مفتاحك الآن — لن يُعرض مرة أخرى.</>
                : <>You've been automatically enrolled in the <span className="font-semibold text-foreground">{apiKeyInfo?.planName}</span> plan with <span className="font-semibold text-foreground">${apiKeyInfo?.creditBalance}</span> in credits. Copy your API key now — it will <strong>not</strong> be shown again.</>
              }
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 py-1">
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2.5 bg-muted rounded-md text-xs font-mono break-all border border-primary/20 select-all" dir="ltr">
                {apiKeyInfo?.fullKey}
              </code>
              <Button variant="outline" size="icon" onClick={copyKey} title={t("common.copy")}>
                {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 space-y-1.5">
              <p className="text-xs font-medium text-amber-600 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {isAr ? "هذه المرة الوحيدة التي ترى فيها المفتاح الكامل." : "This is the only time you'll see the full key."}
              </p>
              <p className="text-xs text-amber-600/80">
                {isAr
                  ? "احفظه في مدير كلمات المرور أو متغير البيئة. يمكنك رؤية المفاتيح الموجودة (البادئة فقط) من صفحة مفاتيح API."
                  : "Store it in a password manager or environment variable. You can view existing keys (prefix only) from the API Keys page."}
              </p>
            </div>

            <div className="rounded-lg bg-muted/50 border p-3 space-y-1">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                {isAr ? "كيف تستخدم مفتاحك" : "How to use your key"}
              </p>
              <code className="block text-[11px] text-muted-foreground font-mono bg-background rounded p-2 border" dir="ltr">
                Authorization: Bearer {apiKeyInfo?.fullKey?.slice(0, 20)}...
              </code>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogAction onClick={handleKeyDialogClose}>
              {isAr ? "نسخت المفتاح — المتابعة" : "I've copied my key — Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
