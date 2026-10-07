import { useMemo, useState } from "react";
import { getDefaultCurrency } from "@/lib/finance-format";
import { Navigate, useNavigate } from "@/lib/router";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Building2, CheckCircle2, ShieldCheck, CalendarClock, Warehouse } from "lucide-react";
import { COUNTRIES, CURRENCIES, getTimezones } from "@/lib/locale-data";
import { EmailVerificationStatus } from "@/components/auth/EmailVerificationStatus";

export default function Onboarding() {
  const { user, loading: authLoading } = useAuth();
  const org = useOrganization();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const timezones = useMemo(() => getTimezones(), []);
  const [form, setForm] = useState({
    name: "",
    country: "",
    currency: getDefaultCurrency(),
    timezone: browserTz,
    depotName: "",
    depotCode: "",
  });

  if (authLoading || org.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!user.email_confirmed_at) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Verify your email</CardTitle>
            <CardDescription>
              Confirm your email address before setting up your organization.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <EmailVerificationStatus email={user.email!} verified={false} />
            <Button variant="ghost" className="w-full" onClick={() => supabase.auth.signOut()}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (org.organizationId && org.organizationId !== "00000000-0000-0000-0000-000000000001") {
    return <Navigate to="/" replace />;
  }

  const handleCountry = (code: string) => {
    const c = COUNTRIES.find((x) => x.code === code);
    setForm((f) => ({
      ...f,
      country: code,
      currency: c?.currency ?? f.currency,
      timezone: c?.timezone ?? f.timezone,
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Organization name is required");
      return;
    }
    setSubmitting(true);
    try {
      const country = COUNTRIES.find((c) => c.code === form.country)?.name ?? null;
      const { data, error } = await supabase.functions.invoke("provision-organization", {
        body: { ...form, country },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const trialEnd = new Date(Date.now() + 14 * 86400000).toLocaleDateString();
      toast.success(`Trial started — ends ${trialEnd}`);
      // Hard reload so RLS / membership context refreshes cleanly.
      window.location.href = "/";
    } catch (err: any) {
      toast.error(err.message ?? "Failed to create organization");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = form.name.trim().length > 1 && !submitting;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="h-6 w-6 text-primary" />
            <CardTitle>Set up your depot organization</CardTitle>
          </div>
          <CardDescription>
            Welcome! Create your organization to start your 14-day free trial of all CDMS modules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <Label>Company / Depot operator name *</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Acme Container Services Ltd"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Country</Label>
                <Select value={form.country} onValueChange={handleCountry}>
                  <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue placeholder="Select currency" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Timezone</Label>
                <Select value={form.timezone} onValueChange={(v) => setForm({ ...form, timezone: v })}>
                  <SelectTrigger><SelectValue placeholder="Select timezone" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {timezones.map((tz) => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">First physical depot (optional)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Depot name</Label>
                  <Input
                    value={form.depotName}
                    onChange={(e) => setForm({ ...form, depotName: e.target.value })}
                    placeholder="Mombasa Yard 1"
                  />
                </div>
                <div>
                  <Label>Depot code</Label>
                  <Input
                    value={form.depotCode}
                    onChange={(e) =>
                      setForm({ ...form, depotCode: e.target.value.replace(/[^A-Z0-9]/gi, "").toUpperCase() })
                    }
                    placeholder="MSA1"
                    maxLength={10}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-md border bg-muted/40 p-4">
              <p className="text-sm font-medium mb-2">Your workspace starts empty — no sample data. When you click Start free trial we will:</p>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  Create your organization on a 14-day trial with all modules unlocked
                </li>
                <li className="flex items-start gap-2">
                  <ShieldCheck className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  Make you the Org Owner with full administrative access
                </li>
                <li className="flex items-start gap-2">
                  <Warehouse className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  Provision your first depot (if a name and code are provided)
                </li>
                <li className="flex items-start gap-2">
                  <CalendarClock className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  Take you to the dashboard — no payment details required
                </li>
              </ul>
            </div>

            <Button type="submit" disabled={!canSubmit} className="w-full">
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start free trial
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
