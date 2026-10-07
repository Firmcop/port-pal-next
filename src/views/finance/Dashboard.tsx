import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Wallet, TrendingUp, TrendingDown, Receipt, ClipboardCheck, ArrowRight, PiggyBank, Truck, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { DataHealthCard } from "@/components/finance/DataHealthCard";
import UpcomingCommitmentsCard from "@/components/finance/UpcomingCommitmentsCard";

function fmt(n: any) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FinanceDashboard() {
  const { data: metrics } = useQuery({
    queryKey: ["finance-dashboard-metrics"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("finance_dashboard_metrics").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: payables } = useQuery({
    queryKey: ["finance-dashboard-payables"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("purchase_orders")
        .select("id, po_number, supplier_name, total_amount, status, created_at")
        .not("status", "in", "(cancelled,draft)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: overdueInvoices } = useQuery({
    queryKey: ["finance-dashboard-overdue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, total_amount, due_at, currency, status")
        .in("status", ["sent", "overdue"])
        .order("due_at", { ascending: true })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const { data: recentTransfers } = useQuery({
    queryKey: ["finance-dashboard-recent-transfers"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("inter_account_transfers")
        .select("id, transfer_number, transfer_date, amount, from_account:financial_accounts!from_account_id(name), to_account:financial_accounts!to_account_id(name)")
        .order("transfer_date", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const { data: logistics } = useQuery({
    queryKey: ["finance-dashboard-logistics-mtd"],
    queryFn: async () => {
      const start = new Date();
      const monthStart = new Date(start.getFullYear(), start.getMonth(), 1).toISOString().slice(0, 10);
      const [pnl, costs] = await Promise.all([
        (supabase as any).from("logistics_trip_pnl").select("revenue,total_cost,gross_margin").gte("trip_date", monthStart),
        (supabase as any)
          .from("logistics_trip_costs")
          .select("amount,category,logistics_trips!inner(trip_date)")
          .gte("logistics_trips.trip_date", monthStart)
          .limit(2000),
      ]);
      const revenue = (pnl.data ?? []).reduce((s: number, r: any) => s + Number(r.revenue || 0), 0);
      const cost = (pnl.data ?? []).reduce((s: number, r: any) => s + Number(r.total_cost || 0), 0);
      const margin = revenue - cost;
      const byCat: Record<string, number> = {};
      for (const c of costs.data ?? []) byCat[c.category] = (byCat[c.category] ?? 0) + Number(c.amount || 0);
      return { revenue, cost, margin, byCat };
    },
  });

  const { data: missingPostings } = useQuery({
    queryKey: ["finance-dashboard-missing-postings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("v_missing_postings").select("reference_type");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: unrecorded } = useQuery({
    queryKey: ["finance-dashboard-unrecorded-payments"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("v_unrecorded_payments").select("reference_type");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: legacyHasData } = useQuery({
    queryKey: ["finance-dashboard-legacy-probe", metrics?.organization_id],
    enabled: Number(metrics?.cash_total ?? 0) === 0 && Number(metrics?.receivables_total ?? 0) === 0,
    queryFn: async () => {
      const { count } = await (supabase as any)
        .from("invoices")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", "00000000-0000-0000-0000-000000000001");
      return (count ?? 0) > 0;
    },
  });



  useRealtimeInvalidate(
    [
      { table: "invoices", queryKeys: ["finance-dashboard-metrics", "finance-dashboard-overdue", "finance-dashboard-missing-postings", "finance-dashboard-unrecorded-payments"] },
      { table: "payments", queryKeys: ["finance-dashboard-metrics", "finance-dashboard-overdue", "finance-dashboard-missing-postings", "finance-dashboard-unrecorded-payments"] },
      { table: "vendor_payments", queryKeys: ["finance-dashboard-metrics", "finance-dashboard-missing-postings", "finance-dashboard-unrecorded-payments"] },
      { table: "accounting_transactions", queryKeys: ["finance-dashboard-metrics", "finance-dashboard-missing-postings"] },
      { table: "inter_account_transfers", queryKeys: ["finance-dashboard-recent-transfers", "finance-dashboard-metrics"] },
      { table: "purchase_orders", queryKeys: ["finance-dashboard-payables", "finance-dashboard-unrecorded-payments"] },
      { table: "goods_receipts", queryKeys: ["finance-dashboard-missing-postings"] },
      { table: "expense_claims", queryKeys: ["finance-dashboard-missing-postings"] },
      { table: "logistics_trip_costs", queryKeys: ["finance-dashboard-logistics-mtd", "finance-dashboard-metrics"] },
      { table: "bank_reconciliations", queryKeys: ["finance-dashboard-metrics"] },
    ],
    "finance-dashboard-rt"
  );

  const cashList = (metrics?.cash_on_hand ?? []) as Array<{ currency: string; amount: number }>;
  const arList = (metrics?.receivables ?? []) as Array<{ currency: string; amount: number }>;
  const logCatEntries = Object.entries(logistics?.byCat ?? {}).sort(([, a], [, b]) => (b as number) - (a as number));
  const logCostTotal = logistics?.cost ?? 0;
  const missingCount = missingPostings?.length ?? 0;
  const unrecordedCount = unrecorded?.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><PiggyBank className="h-6 w-6" />Finance Dashboard</h1>
          <p className="text-muted-foreground">Real-time view of cash, receivables, payables, and reconciliation status. Totals shown in <span className="font-mono">{metrics?.base_currency ?? "—"}</span> (base currency).</p>
        </div>

        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/finance/ledger">Open Ledger <ArrowRight className="ml-1 h-3 w-3" /></Link></Button>
          <Button asChild size="sm"><Link to="/finance/transfers">New Transfer</Link></Button>
        </div>
      </div>

      {legacyHasData && (
        <Card className="border-warning/60 bg-warning/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium">Your dashboards are empty because real data lives in the legacy organization.</p>
              <p className="text-xs text-muted-foreground mt-1">Move invoices, payroll, ledger entries and more into your active tenant in one click. Dry-run first to preview.</p>
            </div>
            <Button asChild size="sm"><Link to="/finance/adopt-legacy-data">Adopt legacy data</Link></Button>
          </CardContent>
        </Card>
      )}

      {(missingCount > 0 || unrecordedCount > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {missingCount > 0 && (
            <Card className="border-warning/50">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-warning"><AlertTriangle className="h-4 w-4" />Documents missing ledger postings</CardTitle></CardHeader>
              <CardContent className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{missingCount} document{missingCount === 1 ? "" : "s"} not posted to the ledger.</p>
                <Button asChild size="sm" variant="outline"><Link to="/finance/ledger">Review</Link></Button>
              </CardContent>
            </Card>
          )}
          {unrecordedCount > 0 && (
            <Card className="border-warning/50">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-warning"><AlertTriangle className="h-4 w-4" />Paid docs missing payment record</CardTitle></CardHeader>
              <CardContent className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{unrecordedCount} paid document{unrecordedCount === 1 ? "" : "s"} need an account attached.</p>
                <Button asChild size="sm" variant="outline"><Link to="/billing/payments">Resolve</Link></Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <DataHealthCard />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-muted-foreground"><Wallet className="h-4 w-4" />Cash on Hand</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-mono font-bold">{fmt(metrics?.cash_total)}</p>
            <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
              {cashList.length === 0 ? <span>No accounts</span> : cashList.map((c) => (
                <div key={c.currency} className="flex justify-between"><span>{c.currency}</span><span className="font-mono">{fmt(c.amount)}</span></div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-muted-foreground"><Receipt className="h-4 w-4" />Outstanding Receivables</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-mono font-bold text-success">{fmt(metrics?.receivables_total)}</p>
            <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
              {arList.length === 0 ? <span>None</span> : arList.map((c) => (
                <div key={c.currency} className="flex justify-between"><span>{c.currency}</span><span className="font-mono">{fmt(c.amount)}</span></div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-muted-foreground"><TrendingDown className="h-4 w-4" />Outstanding Payables</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-mono font-bold text-destructive">{fmt(payables?.reduce((s: number, p: any) => s + Number(p.total_amount || 0), 0))}</p>
            <p className="text-xs text-muted-foreground mt-1">{payables?.length ?? 0} open POs</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-muted-foreground"><TrendingUp className="h-4 w-4" />Month-to-Date P&amp;L</CardTitle></CardHeader>
          <CardContent>
            <p className={`text-2xl font-mono font-bold ${Number(metrics?.mtd_net) >= 0 ? "text-success" : "text-destructive"}`}>{fmt(metrics?.mtd_net)}</p>
            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
              <div className="flex justify-between"><span>Revenue</span><span className="font-mono">{fmt(metrics?.mtd_revenue)}</span></div>
              <div className="flex justify-between"><span>COGS + Exp</span><span className="font-mono">−{fmt(Number(metrics?.mtd_cogs || 0) + Number(metrics?.mtd_expense || 0))}</span></div>
              <div className="flex justify-between"><span>Input VAT</span><span className="font-mono">{fmt(metrics?.mtd_input_vat)}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <UpcomingCommitmentsCard days={30} limit={10} />



      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ClipboardCheck className="h-4 w-4" />Reconciliations</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between"><span className="text-muted-foreground text-sm">In progress</span><Badge variant="secondary" className="bg-warning/15 text-warning">{metrics?.recon_in_progress ?? 0}</Badge></div>
            <div className="flex justify-between"><span className="text-muted-foreground text-sm">Completed</span><Badge variant="secondary" className="bg-success/15 text-success">{metrics?.recon_completed ?? 0}</Badge></div>
            <div className="flex justify-between"><span className="text-muted-foreground text-sm">Last 30 days</span><Badge variant="secondary">{metrics?.recon_recent ?? 0}</Badge></div>
            <Button asChild size="sm" variant="outline" className="w-full mt-2"><Link to="/finance/reconciliations">View all</Link></Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Overdue Invoices</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {!overdueInvoices?.length ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No overdue invoices.</p>
            ) : overdueInvoices.map((i: any) => (
              <Link key={i.id} to={`/billing/invoices`} className="flex justify-between items-center py-1.5 px-2 hover:bg-muted/50 rounded text-sm">
                <div>
                  <span className="font-mono text-xs">{i.invoice_number}</span>
                  <span className="text-muted-foreground ml-2">{i.customer_name}</span>
                </div>
                <div className="text-right">
                  <span className="font-mono">{i.currency} {fmt(i.total_amount)}</span>
                  <span className="text-xs text-muted-foreground ml-2">{i.due_at ? format(new Date(i.due_at), "MMM d") : "—"}</span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Transfers</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {!recentTransfers?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No transfers yet.</p>
          ) : recentTransfers.map((t: any) => (
            <div key={t.id} className="flex justify-between items-center py-1.5 px-2 hover:bg-muted/50 rounded text-sm">
              <div>
                <span className="font-mono text-xs">{t.transfer_number}</span>
                <span className="text-muted-foreground ml-2">{t.from_account?.name} → {t.to_account?.name}</span>
              </div>
              <div className="text-right">
                <span className="font-mono">{fmt(t.amount)}</span>
                <span className="text-xs text-muted-foreground ml-2">{format(new Date(t.transfer_date), "MMM d")}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Truck className="h-4 w-4" />Logistics — Month to date</CardTitle>
          <Button asChild variant="ghost" size="sm"><Link to="/logistics/costs">View all costs <ArrowRight className="ml-1 h-3 w-3" /></Link></Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 mb-3">
            <div><p className="text-xs text-muted-foreground">Revenue</p><p className="text-xl font-mono font-bold text-success">{fmt(logistics?.revenue)}</p></div>
            <div><p className="text-xs text-muted-foreground">Costs</p><p className="text-xl font-mono font-bold text-destructive">{fmt(logCostTotal)}</p></div>
            <div><p className="text-xs text-muted-foreground">Margin</p><p className={`text-xl font-mono font-bold ${Number(logistics?.margin) >= 0 ? "text-success" : "text-destructive"}`}>{fmt(logistics?.margin)}</p></div>
          </div>
          {logCatEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No logistics costs recorded this month.</p>
          ) : (
            <div className="space-y-1">
              {logCatEntries.slice(0, 6).map(([k, v]) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="text-xs capitalize w-32 shrink-0">{k.replace(/_/g, " ")}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded">
                    <div className="h-1.5 bg-primary rounded" style={{ width: `${(Number(v) / Math.max(logCostTotal, 1)) * 100}%` }} />
                  </div>
                  <span className="font-mono text-xs w-28 text-right">{fmt(v)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
