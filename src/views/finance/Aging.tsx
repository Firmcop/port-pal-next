import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock } from "lucide-react";
import { fmtMoney } from "@/lib/finance-format";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { FinanceDataStatus } from "@/components/finance/FinanceDataStatus";

type Bucket = "current" | "d30" | "d60" | "d90" | "d90plus";
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "current", label: "Current" },
  { key: "d30", label: "1-30" },
  { key: "d60", label: "31-60" },
  { key: "d90", label: "61-90" },
  { key: "d90plus", label: "90+" },
];

function bucketize(dueDate: string | null | undefined): Bucket {
  if (!dueDate) return "current";
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
  if (days <= 0) return "current";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "d90plus";
}

type Row = Record<Bucket, number> & { name: string; currency: string; total: number };

/** Groups open documents by party and currency, bucketed by days past due. */
function aggregate(docs: { name: string; currency: string; amount: number; due: string | null }[]): Row[] {
  const m: Record<string, Row> = {};
  for (const d of docs) {
    if (!(d.amount > 0.005)) continue;
    const key = `${d.name}\u0000${d.currency}`;
    if (!m[key]) m[key] = { name: d.name, currency: d.currency, total: 0, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
    const b = bucketize(d.due);
    m[key][b] += d.amount;
    m[key].total += d.amount;
  }
  return Object.values(m).sort((a, b) => a.currency.localeCompare(b.currency) || b.total - a.total);
}

/** One totals row per currency — amounts in different currencies are never added together. */
function totalsByCurrency(rows: Row[]): Row[] {
  const t: Record<string, Row> = {};
  for (const r of rows) {
    if (!t[r.currency]) t[r.currency] = { name: "Totals", currency: r.currency, total: 0, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
    BUCKETS.forEach((b) => (t[r.currency][b.key] += r[b.key]));
    t[r.currency].total += r.total;
  }
  return Object.values(t);
}

export default function Aging() {
  useRealtimeInvalidate([
    { table: "invoices", queryKeys: ["ar-aging-data"] },
    { table: "payments", queryKeys: ["ar-aging-data"] },
    { table: "purchase_orders", queryKeys: ["ap-aging-data"] },
    { table: "vendor_payments", queryKeys: ["ap-aging-data"] },
  ], "aging-rt");
  const { data: ar } = useQuery({
    queryKey: ["ar-aging-data"],
    queryFn: async () => {
      // Open = sent/overdue and not voided; outstanding = total less payments received.
      const { data, error } = await supabase
        .from("invoices")
        .select("customer_name, customers:customer_id(company_name), total_amount, due_at, issued_at, currency, payments(amount)")
        .in("status", ["sent", "overdue"])
        .is("voided_at", null)
        .limit(5000);
      if (error) throw error;
      return (data as any[]).map((r) => ({
        name: r.customers?.company_name || r.customer_name || "Unknown",
        currency: r.currency || "",
        amount: Number(r.total_amount || 0) - (r.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0),
        due: r.due_at || r.issued_at,
      }));
    },
  });

  const { data: ap } = useQuery({
    queryKey: ["ap-aging-data"],
    queryFn: async () => {
      // Supplier bills (including the PO bills raised automatically) that are not fully paid.
      const { data, error } = await supabase
        .from("supplier_invoices")
        .select("total_amount, paid_amount, due_date, issue_date, currency, suppliers:supplier_id(name)")
        .in("status", ["issued", "partially_paid"])
        .limit(5000);
      if (error) throw error;
      return (data as any[]).map((r) => ({
        name: r.suppliers?.name || "Unknown supplier",
        currency: r.currency || "",
        amount: Number(r.total_amount || 0) - Number(r.paid_amount || 0),
        due: r.due_date || r.issue_date,
      }));
    },
  });

  const arRows = useMemo(() => aggregate(ar ?? []), [ar]);
  const apRows = useMemo(() => aggregate(ap ?? []), [ap]);
  const arTotals = useMemo(() => totalsByCurrency(arRows), [arRows]);
  const apTotals = useMemo(() => totalsByCurrency(apRows), [apRows]);

  const renderTable = (rows: Row[], totals: Row[], label: string) => (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-base">{label}</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {BUCKETS.map((b) => <TableHead key={b.key} className="text-right">{b.label}</TableHead>)}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nothing outstanding.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={`${r.name}-${r.currency}`}>
                <TableCell>{r.name} <span className="text-xs text-muted-foreground">{r.currency}</span></TableCell>
                {BUCKETS.map((b) => <TableCell key={b.key} className="text-right font-mono">{r[b.key] ? fmtMoney(r[b.key], r.currency) : "—"}</TableCell>)}
                <TableCell className="text-right font-mono font-semibold">{fmtMoney(r.total, r.currency)}</TableCell>
              </TableRow>
            ))}
            {totals.map((t) => (
              <TableRow key={`totals-${t.currency}`} className="font-bold border-t-2">
                <TableCell>Totals {t.currency}</TableCell>
                {BUCKETS.map((b) => <TableCell key={b.key} className="text-right font-mono">{fmtMoney(t[b.key], t.currency)}</TableCell>)}
                <TableCell className="text-right font-mono">{fmtMoney(t.total, t.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Clock className="h-6 w-6" />Aging Reports</h1>
        <p className="text-muted-foreground">Outstanding receivables and payables bucketed by age.</p>
      </div>
      <FinanceDataStatus queryKeys={["ar-aging-data", "ap-aging-data"]} />
      <Tabs defaultValue="ar">
        <TabsList>
          <TabsTrigger value="ar">Receivables (AR)</TabsTrigger>
          <TabsTrigger value="ap">Payables (AP)</TabsTrigger>
        </TabsList>
        <TabsContent value="ar">{renderTable(arRows, arTotals, "Customer Aging")}</TabsContent>
        <TabsContent value="ap">{renderTable(apRows, apTotals, "Supplier Aging")}</TabsContent>
      </Tabs>
    </div>
  );
}
