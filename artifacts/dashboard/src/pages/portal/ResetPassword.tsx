import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Terminal, CheckCircle2, AlertCircle } from "lucide-react";
import i18n from "@/i18n";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const isAr = i18n.language === "ar";
  const token = searchParams.get("token");
  const [done, setDone] = useState(false);

  const schema = z.object({
    password: z.string().min(8, t("auth.passwordMin")),
    confirmPassword: z.string(),
  }).refine((d) => d.password === d.confirmPassword, {
    message: t("auth.passwordMismatch"),
    path: ["confirmPassword"],
  });

  useEffect(() => {
    if (!token) {
      toast({ title: t("auth.invalidResetLink"), description: t("auth.invalidResetLinkDesc"), variant: "destructive" });
    }
  }, [token, toast, t]);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async ({ password }: z.infer<typeof schema>) => {
    if (!token) return;
    try {
      const res = await fetch("/api/portal/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: t("auth.invalidResetLink"), description: data.error || t("auth.invalidResetLinkDesc"), variant: "destructive" });
        return;
      }
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 3000);
    } catch {
      toast({ title: t("common.error"), description: isAr ? "يرجى المحاولة مجدداً." : "Please try again.", variant: "destructive" });
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4" dir={isAr ? "rtl" : "ltr"}>
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="font-medium">{t("auth.invalidResetLink")}</p>
              <p className="text-sm text-muted-foreground">{t("auth.invalidResetLinkDesc")}</p>
              <Link to="/forgot-password">
                <Button variant="outline" className="mt-2">{t("auth.requestNewLink")}</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/40 p-4" dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-8 flex flex-col items-center">
        <div className="bg-primary/10 p-3 rounded-full mb-4">
          <Terminal className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">AI Gateway</h1>
        <p className="text-muted-foreground mt-2">{t("portal.title")}</p>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("auth.setNewPassword")}</CardTitle>
          <CardDescription>{isAr ? "اختر كلمة مرور قوية لحسابك." : "Choose a strong password for your account."}</CardDescription>
        </CardHeader>

        {done ? (
          <CardContent>
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="font-medium">{t("auth.passwordChanged")}</p>
              <p className="text-sm text-muted-foreground">{t("auth.passwordChangedDesc")}</p>
            </div>
          </CardContent>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="password" render={({ field }) => (
                  <FormItem>
                    <Label>{t("auth.newPassword")}</Label>
                    <FormControl>
                      <Input placeholder={isAr ? "٨ أحرف على الأقل" : "Min. 8 characters"} type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                  <FormItem>
                    <Label>{t("auth.confirmPassword")}</Label>
                    <FormControl>
                      <Input placeholder={isAr ? "أعد إدخال كلمة المرور" : "Repeat your password"} type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
              <CardFooter>
                <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? (isAr ? "جارٍ الحفظ..." : "Saving...") : t("auth.setNewPassword")}
                </Button>
              </CardFooter>
            </form>
          </Form>
        )}
      </Card>
    </div>
  );
}
