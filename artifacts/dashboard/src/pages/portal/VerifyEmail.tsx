import { useState, useEffect, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Terminal, CheckCircle2, AlertCircle, Loader2, MailX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Status = "loading" | "success" | "error" | "missing";

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>(token ? "loading" : "missing");
  const [errorMsg, setErrorMsg] = useState("");
  const called = useRef(false);

  useEffect(() => {
    if (!token || called.current) return;
    called.current = true;

    fetch("/api/portal/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (res.ok) {
          setStatus("success");
        } else {
          const data = await res.json().catch(() => ({}));
          setErrorMsg(data.error ?? "Verification failed. The link may have expired.");
          setStatus("error");
        }
      })
      .catch(() => {
        setErrorMsg("Network error. Please try again.");
        setStatus("error");
      });
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/40 p-4">
      <div className="mb-8 flex flex-col items-center">
        <div className="bg-primary/10 p-3 rounded-full mb-4">
          <Terminal className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">AI Gateway</h1>
        <p className="text-muted-foreground mt-2">Developer Portal</p>
      </div>

      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-3 text-center">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <p className="font-medium text-lg">Verifying your email...</p>
              <p className="text-sm text-muted-foreground">Please wait a moment.</p>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <p className="font-semibold text-lg">Email Verified!</p>
              <p className="text-sm text-muted-foreground">
                Your email has been verified successfully. You can now log in and start using the API.
              </p>
              <Link to="/login" className="mt-2">
                <Button className="w-full">Go to Login</Button>
              </Link>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 text-center">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="font-semibold text-lg">Verification Failed</p>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
              <div className="flex flex-col gap-2 w-full mt-2">
                <Link to="/login">
                  <Button variant="default" className="w-full">Go to Login</Button>
                </Link>
                <p className="text-xs text-muted-foreground">
                  You can request a new verification link from the login page.
                </p>
              </div>
            </div>
          )}

          {status === "missing" && (
            <div className="flex flex-col items-center gap-3 text-center">
              <MailX className="h-12 w-12 text-muted-foreground" />
              <p className="font-semibold text-lg">Invalid Link</p>
              <p className="text-sm text-muted-foreground">
                This verification link is invalid or incomplete.
              </p>
              <Link to="/login" className="mt-2">
                <Button variant="outline" className="w-full">Go to Login</Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
