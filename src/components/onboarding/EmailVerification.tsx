import { ReactNode, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MailWarning, Loader2 } from "lucide-react";
import { toast } from "sonner";

const GRACE_DAYS = 7;

/** Where this person stands on confirming their email: people who signed up through
 *  the trial get 7 days before Port Pal asks them to confirm before going on. */
export function useEmailVerification() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["email-verification", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("profiles").select("email_verified_at").eq("user_id", user!.id).maybeSingle();
      // A database without the column (before Phase 1) means: nothing to check.
      if (error) return { verified: true };
      return { verified: !!data?.email_verified_at || !data };
    },
  });
  const created = user?.created_at ? new Date(user.created_at).getTime() : Date.now();
  const daysLeft = Math.max(0, Math.ceil(GRACE_DAYS - (Date.now() - created) / 86_400_000));
  const pending = !!data && !data.verified;
  return { pending, overdue: pending && daysLeft === 0, daysLeft, email: user?.email ?? "" };
}

function useResend() {
  const [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    const { data, error } = await supabase.functions.invoke("resend-verification", { body: {} });
    setSending(false);
    const body: any = data ?? (await (error as any)?.context?.json?.().catch(() => null));
    if (error || !body?.ok) toast.error(body?.error ?? "Could not send the email. Please try again.");
    else if (body.verified) toast.success("Your email is already confirmed.");
    else toast.success("Sent. Check your inbox (and spam folder).");
  };
  return { sending, send };
}

export function EmailVerificationBanner() {
  const v = useEmailVerification();
  const { sending, send } = useResend();
  if (!v.pending || v.overdue) return null;
  return (
    <div className="border-b px-4 py-2 text-sm flex flex-wrap items-center gap-2 bg-warning/10 border-warning/30">
      <MailWarning className="h-4 w-4 text-warning" />
      <span>
        Please confirm your email — we sent a link to <strong>{v.email}</strong>.{" "}
        {v.daysLeft === 1 ? "1 day left." : `${v.daysLeft} days left.`}
      </span>
      <Button size="sm" variant="ghost" className="ms-auto h-7" onClick={send} disabled={sending}>
        {sending && <Loader2 className="me-1 h-3 w-3 animate-spin" />} Send it again
      </Button>
    </div>
  );
}

/** After the grace period the app waits for confirmation. */
export function EmailVerificationGate({ children }: { children: ReactNode }) {
  const v = useEmailVerification();
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const { sending, send } = useResend();
  if (!v.overdue) return <>{children}</>;
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center space-y-4">
          <MailWarning className="h-12 w-12 mx-auto text-warning" />
          <h1 className="text-xl font-bold">Confirm your email to continue</h1>
          <p className="text-muted-foreground">
            We sent a link to <strong>{v.email}</strong>. Open it, then come back here. Your data is safe.
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={send} disabled={sending}>{sending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}Send the link again</Button>
            <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["email-verification"] })}>I've confirmed it</Button>
            <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
