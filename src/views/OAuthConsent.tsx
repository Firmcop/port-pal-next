import { useEffect, useState } from "react";
import { useSearchParams } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";

// Beta typed wrapper for the Supabase Auth OAuth server helpers.
type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};
function oauthClient(): OAuthNamespace {
  return (supabase.auth as any).oauth as OAuthNamespace;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      try {
        const { data, error } = await oauthClient().getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) {
          setError(error.message || "Could not load authorization request.");
          return;
        }
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      } catch (e: any) {
        if (active) setError(e?.message ?? "Unexpected error loading authorization.");
      }
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { data, error } = approve
        ? await oauthClient().approveAuthorization(authorizationId)
        : await oauthClient().denyAuthorization(authorizationId);
      if (error) {
        setError(error.message || "The authorization server rejected the request.");
        setBusy(false);
        return;
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setError("No redirect returned by the authorization server.");
        setBusy(false);
        return;
      }
      window.location.href = target;
    } catch (e: any) {
      setError(e?.message ?? "Unexpected error.");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">
            {details?.client?.name ? `Connect ${details.client.name}` : "Authorize access"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {!details && !error && (
            <p className="text-sm text-muted-foreground text-center">Loading authorization request…</p>
          )}
          {details && (
            <>
              <p className="text-sm text-muted-foreground">
                This lets <strong>{details.client?.name ?? "the client"}</strong> use Port Pal as you. It will be able to
                call this app's enabled tools while you are signed in.
              </p>
              <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
                <div><span className="text-muted-foreground">Client:</span> {details.client?.name ?? "Unknown"}</div>
                {details.client?.client_uri && (
                  <div className="truncate"><span className="text-muted-foreground">Website:</span> {details.client.client_uri}</div>
                )}
                {details.redirect_uri && (
                  <div className="truncate"><span className="text-muted-foreground">Redirect:</span> {details.redirect_uri}</div>
                )}
                {details.scope && (
                  <div><span className="text-muted-foreground">Scope:</span> {details.scope}</div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                This does not bypass Port Pal's permissions or backend policies. Tools act with your
                organization, role, and data-access limits.
              </p>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
                  {busy ? "Working…" : "Approve"}
                </Button>
                <Button className="flex-1" variant="outline" disabled={busy} onClick={() => decide(false)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
