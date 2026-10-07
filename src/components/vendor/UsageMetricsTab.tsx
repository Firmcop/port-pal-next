import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveContainer, AreaChart, Area, Tooltip, XAxis } from "recharts";

type Series = { d: string; v: number }[];

const KPI = ({ label, value }: { label: string; value: string | number }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className="text-xl font-semibold">{value}</div>
  </div>
);

const Sparkline = ({ data }: { data?: Series }) => {
  if (!data?.length) return null;
  return (
    <div className="h-16 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="d" hide />
          <Tooltip
            contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
            labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          />
          <Area type="monotone" dataKey="v" stroke="hsl(var(--primary))" fill="url(#spark)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

interface Props {
  organizationId: string;
  enabledModules: string[];
}

export function UsageMetricsTab({ organizationId, enabledModules }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["org-usage", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("org_usage_metrics", { _org_id: organizationId, _days: 30 });
      if (error) throw error;
      return data as any;
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
      </div>
    );
  }
  if (!data) return <p className="text-muted-foreground text-sm">No usage data.</p>;

  const has = (m: string) => m === "core" || enabledModules.includes(m);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Last 30 days · {data.members?.active ?? 0} active members</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {has("inventory") && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Inventory</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <KPI label="Total containers" value={data.inventory?.total_containers ?? 0} />
                <KPI label="Added (30d)" value={data.inventory?.added ?? 0} />
              </div>
              <Sparkline data={data.inventory?.series} />
            </CardContent>
          </Card>
        )}
        {has("gate") && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Gate</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <KPI label="Gate-in" value={data.gate?.gate_in ?? 0} />
                <KPI label="Gate-out" value={data.gate?.gate_out ?? 0} />
                <KPI label="Appts" value={data.gate?.appointments ?? 0} />
              </div>
              <Sparkline data={data.gate?.series} />
            </CardContent>
          </Card>
        )}
        {has("mr") && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Maintenance & Repair</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <KPI label="Open WOs" value={data.mr?.work_orders_open ?? 0} />
                <KPI label="WOs (30d)" value={data.mr?.work_orders_recent ?? 0} />
                <KPI label="Inspections" value={data.mr?.inspections ?? 0} />
              </div>
              <Sparkline data={data.mr?.series} />
            </CardContent>
          </Card>
        )}
        {has("billing") && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Billing</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <KPI label="Invoices" value={data.billing?.invoices ?? 0} />
                <KPI label="Paid" value={data.billing?.invoices_paid ?? 0} />
                <KPI label="Payments" value={data.billing?.payments ?? 0} />
                <KPI label="Revenue" value={Number(data.billing?.revenue ?? 0).toLocaleString()} />
              </div>
              <Sparkline data={data.billing?.series} />
            </CardContent>
          </Card>
        )}
        {has("accounting") && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Accounting</CardTitle></CardHeader>
            <CardContent>
              <KPI label="Transactions (30d)" value={data.accounting?.transactions ?? 0} />
            </CardContent>
          </Card>
        )}
        {has("crm") && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">CRM</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <KPI label="Leads" value={data.crm?.leads ?? 0} />
              <KPI label="Deals" value={data.crm?.deals ?? 0} />
              <KPI label="Quotes" value={data.crm?.quotes ?? 0} />
            </CardContent>
          </Card>
        )}
        {has("procurement") && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Procurement</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <KPI label="POs" value={data.procurement?.purchase_orders ?? 0} />
              <KPI label="Receipts" value={data.procurement?.goods_receipts ?? 0} />
            </CardContent>
          </Card>
        )}
        {has("leasing") && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Leasing</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <KPI label="Agreements" value={data.leasing?.agreements ?? 0} />
              <KPI label="New (30d)" value={data.leasing?.agreements_recent ?? 0} />
            </CardContent>
          </Card>
        )}
        {has("portal") && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Customer portal</CardTitle></CardHeader>
            <CardContent>
              <KPI label="Release instructions (30d)" value={data.portal?.release_instructions ?? 0} />
            </CardContent>
          </Card>
        )}
        {has("whatsapp") && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">WhatsApp</CardTitle></CardHeader>
            <CardContent>
              <KPI label="Messages queued (30d)" value={data.whatsapp?.messages ?? 0} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
