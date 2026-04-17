import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Terminal, CheckCircle2, ArrowLeft, ArrowRight } from "lucide-react";
import i18n from "@/i18n";

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const { t } = useTranslation();
  const isAr = i18n.language === "ar";

  const schema = z.object({
    email: z.string().email(isAr ? "أدخل بريداً إلكترونياً صحيحاً" : "Please enter a valid email address"),
  });

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = async ({ email }: z.infer<typeof schema>) => {
    try {
      await fetch("/api/portal/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // ignore — always show success to prevent email enumeration
    }
    setSent(true);
  };

  const BackIcon = isAr ? ArrowRight : ArrowLeft;

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
          <CardTitle>{t("auth.resetPassword")}</CardTitle>
          <CardDescription>{t("auth.resetPasswordDesc")}</CardDescription>
        </CardHeader>

        {sent ? (
          <>
            <CardContent>
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                <p className="font-medium">{t("auth.checkEmail")}</p>
                <p className="text-sm text-muted-foreground">{t("auth.checkEmailDesc")}</p>
              </div>
            </CardContent>
            <CardFooter>
              <Link to="/login" className="w-full">
                <Button variant="outline" className="w-full gap-2">
                  <BackIcon className="h-4 w-4" />
                  {t("auth.backToSignIn")}
                </Button>
              </Link>
            </CardFooter>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <Label>{t("common.email")}</Label>
                    <FormControl>
                      <Input placeholder="developer@example.com" type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
              <CardFooter className="flex flex-col gap-3">
                <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? t("auth.sending") : t("auth.sendResetLink")}
                </Button>
                <Link to="/login" className="text-sm text-center text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-1">
                  <BackIcon className="h-3 w-3" />
                  {t("auth.backToSignIn")}
                </Link>
              </CardFooter>
            </form>
          </Form>
        )}
      </Card>
    </div>
  );
}
