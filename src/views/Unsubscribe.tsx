import { useEffect, useState } from "react";
import { useSearchParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

type State = "loading" | "valid" | "already" | "invalid" | "submitting" | "done" | "error";

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
    fetch(
      `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
      { headers: { apikey: anon } }
    )
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setState("invalid");
          setError(data.error || "Invalid or expired link");
          return;
        }
        if (data.valid === false && data.reason === "already_unsubscribed") {
          setState("already");
          return;
        }
        setState("valid");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    setState("submitting");
    const { data, error: invokeErr } = await supabase.functions.invoke(
      "handle-email-unsubscribe",
      { body: { token } }
    );
    if (invokeErr) {
      setState("error");
      setError(invokeErr.message);
      return;
    }
    if (data?.success || data?.reason === "already_unsubscribed") {
      setState("done");
    } else {
      setState("error");
      setError(data?.error || "Failed to unsubscribe");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Email preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === "loading" && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Validating link...
            </p>
          )}
          {state === "invalid" && (
            <p className="flex items-start gap-2 text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <span>{error || "This unsubscribe link is invalid or has expired."}</span>
            </p>
          )}
          {state === "already" && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="h-5 w-5 text-success" />
              You are already unsubscribed.
            </p>
          )}
          {(state === "valid" || state === "submitting") && (
            <>
              <p className="text-sm text-muted-foreground">
                Confirm to stop receiving emails from Firmcop CDMS at this address.
                You will still receive critical security and account emails.
              </p>
              <Button onClick={confirm} disabled={state === "submitting"} className="w-full">
                {state === "submitting" ? "Processing..." : "Confirm unsubscribe"}
              </Button>
            </>
          )}
          {state === "done" && (
            <p className="flex items-center gap-2 text-foreground">
              <CheckCircle2 className="h-5 w-5 text-success" />
              You have been unsubscribed successfully.
            </p>
          )}
          {state === "error" && (
            <p className="flex items-start gap-2 text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
