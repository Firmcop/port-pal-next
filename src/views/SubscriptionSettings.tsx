import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDefaultCurrency } from "@/lib/finance-format";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Check } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type CatalogModule = { code: string; name: string; description: string | null; monthly_price: number; is_core: boolean; sort_order: number };
type SubModule = { module_code: string; enabled: boolean; price_snapshot: number };

export default function SubscriptionSettings() {
  const org = useOrganization();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["subscription-overview", org.organizationId],
    enabled: !!org.organizationId,
    queryFn: async () => {
      const [catalog, sub, mods, seats, invoices] = await Promise.all([
        supabase.from("modules_catalog").select("*").order("sort_order"),
        supabase.from("subscriptions").select("*").eq("organization_id", org.organizationId!).maybeSingle(),
        supabase.from("subscription_modules").select("module_code, enabled, price_snapshot").eq("organization_id", org.organizationId!),
        supabase.from("organization_members").select("id", { count: "exact", head: true }).eq("organization_id", org.organizationId!).eq("status", "active"),
        supabase.from("platform_invoices").select("id, invoice_number, period_start, period_end, total, currency, status, issued_at, due_at, paid_at").eq("organization_id", org.organizationId!).order("created_at", { ascending: false }).limit(24),
      ]);
      return {
        catalog: (catalog.data ?? []) as CatalogModule[],
        subscription: sub.data as any,
        modules: (mods.data ?? []) as SubModule[],
        seatCount: seats.count ?? 0,
        invoices: (invoices.data ?? []) as any[],
      };
    },
  });

  const toggleModule = async (code: string, enabled: boolean, price: number) => {
    if (!org.organizationId) return;
    const { error } = await supabase
      .from("subscription_modules")
      .upsert({
        organization_id: org.organizationId,
        module_code: code,
        enabled,
        price_snapshot: price,
      }, { onConflict: "organization_id,module_code" });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(enabled ? "Module enabled" : "Module disabled");
    qc.invalidateQueries({ queryKey: ["subscription-overview"] });
    qc.invalidateQueries({ queryKey: ["enabled-modules"] });
  };

  if (org.loading || isLoading || !data) {
    return <div className="p-6"><Loader2 className="animate-spin" /></div>;
  }

  const sub = data.subscription;
  const enabledMap = new Map(data.modules.filter((m) => m.enabled).map((m) => [m.module_code, m]));
  const enabledModulesTotal = data.modules
    .filter((m) => m.enabled)
    .reduce((sum, m) => sum + Number(m.price_snapshot ?? 0), 0);
  const seatTotal = data.seatCount * Number(sub?.per_seat_fee ?? 0);
  const monthlyTotal = Number(sub?.base_fee ?? 0) + enabledModulesTotal + seatTotal;

  const isOrgAdmin = org.role === "org_owner" || org.role === "admin";

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Subscription & Billing</h1>
        <p className="text-muted-foreground">Modules and seats currently provisioned for {org.organizationName}.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard label="Status" value={<Badge variant={sub?.status === "active" ? "default" : "secondary"} className="capitalize">{sub?.status ?? "—"}</Badge>} />
        <SummaryCard label="Active users" value={`${data.seatCount}${sub?.seat_limit ? ` / ${sub.seat_limit}` : ""}`} />
        <SummaryCard label="Per-seat fee" value={`${sub?.currency ?? getDefaultCurrency()} ${Number(sub?.per_seat_fee ?? 0).toFixed(2)}`} />
        <SummaryCard label="Period ends" value={sub?.current_period_end ? format(new Date(sub.current_period_end), "PP") : "—"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Estimated monthly charge</CardTitle>
          <CardDescription>Based on enabled modules and active users today.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm">
            <Row label="Base fee" amount={Number(sub?.base_fee ?? 0)} currency={sub?.currency} />
            <Row label={`Modules (${enabledMap.size})`} amount={enabledModulesTotal} currency={sub?.currency} />
            <Row label={`Seats (${data.seatCount} × ${Number(sub?.per_seat_fee ?? 0).toFixed(2)})`} amount={seatTotal} currency={sub?.currency} />
            <div className="border-t mt-2 pt-2 flex justify-between font-semibold">
              <span>Total</span>
              <span>{sub?.currency ?? getDefaultCurrency()} {monthlyTotal.toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modules</CardTitle>
          <CardDescription>Toggle modules to add or remove them from your subscription.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.catalog.map((mod) => {
            const sm = data.modules.find((m) => m.module_code === mod.code);
            const enabled = !!sm?.enabled;
            return (
              <div key={mod.code} className="flex items-center justify-between border rounded-lg p-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{mod.name}</span>
                    {mod.is_core && <Badge variant="secondary"><Check className="h-3 w-3 mr-1" />Included</Badge>}
                  </div>
                  {mod.description && <p className="text-sm text-muted-foreground">{mod.description}</p>}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground">{sub?.currency ?? getDefaultCurrency()} {Number(mod.monthly_price).toFixed(2)}/mo</span>
                  <Switch
                    checked={enabled || mod.is_core}
                    disabled={mod.is_core || !isOrgAdmin}
                    onCheckedChange={(v) => toggleModule(mod.code, v, mod.monthly_price)}
                  />
                </div>
              </div>
            );
          })}
          {!isOrgAdmin && <p className="text-xs text-muted-foreground">Only organization owners and admins can change modules.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing history</CardTitle>
          <CardDescription>Past invoices issued by the platform.</CardDescription>
        </CardHeader>
        <CardContent>
          {!data.invoices.length ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <div className="space-y-2">
              {data.invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between border rounded-lg p-3 text-sm">
                  <div>
                    <div className="font-mono text-xs">{inv.invoice_number}</div>
                    <div className="text-xs text-muted-foreground">{inv.period_start} → {inv.period_end}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono">{inv.currency} {Number(inv.total).toFixed(2)}</span>
                    <Badge variant={inv.status === "paid" ? "default" : inv.status === "overdue" ? "destructive" : "secondary"} className="capitalize">{inv.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-lg font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function Row({ label, amount, currency }: { label: string; amount: number; currency?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{currency ?? getDefaultCurrency()} {amount.toFixed(2)}</span>
    </div>
  );
}
