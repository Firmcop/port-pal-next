import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

const MESSAGES: Record<string, string> = {
  expired: "This link has expired. Sign in and send yourself a new one from the banner at the top.",
  invalid: "This link isn't valid. Use the newest email we sent, or send a new one after signing in.",
  email_changed: "Your email address has changed since this link was sent. Send a new link after signing in.",
};

/** The link in the "confirm your email" message. Works without being signed in. */
export default function VerifyEmail() {
  const [state, setState] = useState<{ status: "working" | "ok" | "error"; reason?: string }>({ status: "working" });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    (supabase as any)
      .rpc("confirm_email_verification", { _token: token })
      .then(({ data, error }: any) => {
        if (error) setState({ status: "error", reason: "invalid" });
        else if (data?.ok) setState({ status: "ok" });
        else setState({ status: "error", reason: data?.reason ?? "invalid" });
      });
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center space-y-4">
          {state.status === "working" && <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />}
          {state.status === "ok" && (
            <>
              <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
              <h1 className="text-xl font-bold">Email confirmed</h1>
              <p className="text-muted-foreground">Thanks — your Port Pal account is all set.</p>
              <Button asChild><Link to="/">Open Port Pal</Link></Button>
            </>
          )}
          {state.status === "error" && (
            <>
              <XCircle className="h-12 w-12 mx-auto text-destructive" />
              <h1 className="text-xl font-bold">We couldn't confirm your email</h1>
              <p className="text-muted-foreground">{MESSAGES[state.reason ?? "invalid"] ?? MESSAGES.invalid}</p>
              <Button asChild variant="outline"><Link to="/login">Sign in</Link></Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
