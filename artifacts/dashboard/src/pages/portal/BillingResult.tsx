import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import i18n from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, Wallet, ArrowRight } from "lucide-react";

export default function BillingResult() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = params.get("status"); // "success" | "failure"
  const isAr = i18n.language === "ar";
  const [secondsLeft, setSecondsLeft] = useState(8);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          navigate("/portal/billing", { replace: true });
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [navigate]);

  const success = status === "success";

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/40" dir={isAr ? "rtl" : "ltr"}>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3">
            {success
              ? <CheckCircle2 className="h-16 w-16 text-green-500" />
              : <XCircle className="h-16 w-16 text-destructive" />}
          </div>
          <CardTitle className="text-2xl">
            {success
              ? (isAr ? "تمت العملية بنجاح" : "Payment successful")
              : (isAr ? "لم تكتمل العملية" : "Payment did not complete")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-muted-foreground">
            {success
              ? (isAr
                  ? "سيُضاف الرصيد إلى حسابك خلال ثوانٍ بعد تأكيد بوابة الدفع."
                  : "Your credits will be added within seconds once the gateway confirms.")
              : (isAr
                  ? "تم إلغاء العملية أو فشلت. لم يُخصم من حسابك أي مبلغ."
                  : "The transaction was canceled or failed. You were not charged.")}
          </p>
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1 justify-center">
            <Loader2 className="h-3 w-3 animate-spin" />
            {isAr ? `إعادة التوجيه خلال ${secondsLeft} ثوان...` : `Redirecting in ${secondsLeft}s...`}
          </p>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => navigate("/portal/billing")} className="w-full">
              <Wallet className="h-4 w-4 mr-2" />
              {isAr ? "العودة لصفحة الشحن" : "Back to Top-up"}
            </Button>
            <Button variant="outline" onClick={() => navigate("/portal")} className="w-full">
              {isAr ? "لوحة التحكم" : "Dashboard"}
              <ArrowRight className={`h-4 w-4 ${isAr ? "mr-2 rotate-180" : "ml-2"}`} />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
