import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Container, Loader2 } from "lucide-react";
import { toast } from "sonner";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin", yard_operator: "Yard Operator", gate_clerk: "Gate Clerk", viewer: "Viewer",
};

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [state, setState] = useState<"loading" | "valid" | "invalid" | "submitting" | "done">("loading");
  const [meta, setMeta] = useState<any>(null);
  const [error, setError] = useState<string>("");
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    (async () => {
      if (!token) { setState("invalid"); setError("Missing invitation token."); return; }
      const tokenHash = await sha256Hex(token);
      const { data, error } = await supabase.rpc("get_invitation_preview", { _token_hash: tokenHash });
      if (error || !data || !(data as any).valid) {
        setState("invalid");
        setError(
          (data as any)?.reason === "expired" ? "This invitation has expired."
          : (data as any)?.reason === "revoked" ? "This invitation was revoked."
          : (data as any)?.reason === "already_accepted" ? "This invitation was already accepted."
          : "Invalid invitation link.",
        );
        return;
      }
      setMeta(data);
      setState("valid");
    })();
  }, [token]);

  const submit = async () => {
    if (pwd.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (pwd !== confirm) { toast.error("Passwords do not match"); return; }
    setState("submitting");
    const { data, error } = await supabase.functions.invoke("accept-staff-invite", {
      body: { token, password: pwd },
    });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error ?? error?.message ?? "Could not accept invitation");
      setState("valid");
      return;
    }
    // Sign the user in
    const { error: signErr } = await supabase.auth.signInWithPassword({ email: meta.email, password: pwd });
    if (signErr) {
      toast.success("Account ready — please sign in.");
      navigate("/login");
      return;
    }
    setState("done");
    setTimeout(() => navigate("/"), 800);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/20">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2"><Container className="h-5 w-5 text-primary" /><span className="font-semibold">CDMS</span></div>
          <CardTitle>Accept your invitation</CardTitle>
          <CardDescription>
            {state === "loading" && "Checking invitation…"}
            {state === "invalid" && error}
            {(state === "valid" || state === "submitting") && (
              <>You've been invited to join <strong>{meta?.organization_name}</strong> as <Badge variant="secondary" className="ml-1">{ROLE_LABELS[meta?.role] ?? meta?.role}</Badge></>
            )}
            {state === "done" && "All set! Signing you in…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === "loading" && <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />}
          {state === "invalid" && (
            <Button variant="outline" className="w-full" onClick={() => navigate("/login")}>Go to sign in</Button>
          )}
          {(state === "valid" || state === "submitting") && (
            <>
              <div>
                <Label>Email</Label>
                <Input value={meta?.email ?? ""} disabled />
              </div>
              <div>
                <Label htmlFor="pwd">Set a password</Label>
                <Input id="pwd" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="At least 8 characters" />
              </div>
              <div>
                <Label htmlFor="cfm">Confirm password</Label>
                <Input id="cfm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <Button className="w-full" onClick={submit} disabled={state === "submitting"}>
                {state === "submitting" ? "Setting up…" : "Accept and continue"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
