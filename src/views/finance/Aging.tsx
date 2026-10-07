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

function aggregate(rows: any[], nameField: string, amountField: string, dateField: string) {
  const m: Record<string, Record<Bucket, number> & { name: string; total: number }> = {};
  for (const r of rows) {
    const name = r[nameField] || "Unknown";
    if (!m[name]) m[name] = { name, total: 0, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
    const b = bucketize(r[dateField]);
    const amt = Number(r[amountField] || 0);
    m[name][b] += amt;
    m[name].total += amt;
  }
  return Object.values(m).sort((a, b) => b.total - a.total);
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
      const { data, error } = await supabase
        .from("invoices")
        .select("customer_name, total_amount, due_at, status, currency")
        .in("status", ["sent", "overdue", "issued"] as any)
        .is("voided_at", null)
        .eq("partially_paid", false)
        .limit(2000);
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: ap } = useQuery({
    queryKey: ["ap-aging-data"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders" as any)
        .select("supplier_name, total_cost, expected_delivery_date, status, created_at")
        .in("status", ["approved", "received", "partially_received"])
        .limit(2000);
      if (error) throw error;
      return (data as any[]).map((r) => ({ ...r, due_date: r.expected_delivery_date || r.created_at }));
    },
  });

  const arRows = useMemo(() => aggregate(ar ?? [], "customer_name", "total_amount", "due_at"), [ar]);
  const apRows = useMemo(() => aggregate(ap ?? [], "supplier_name", "total_cost", "due_date"), [ap]);

  const arTotals = arRows.reduce((acc, r) => {
    BUCKETS.forEach((b) => (acc[b.key] += r[b.key]));
    acc.total += r.total;
    return acc;
  }, { total: 0, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 } as any);
  const apTotals = apRows.reduce((acc, r) => {
    BUCKETS.forEach((b) => (acc[b.key] += r[b.key]));
    acc.total += r.total;
    return acc;
  }, { total: 0, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 } as any);

  const renderTable = (rows: any[], totals: any, label: string) => (
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
              <TableRow key={r.name}>
                <TableCell>{r.name}</TableCell>
                {BUCKETS.map((b) => <TableCell key={b.key} className="text-right font-mono">{r[b.key] ? fmtMoney(r[b.key]) : "—"}</TableCell>)}
                <TableCell className="text-right font-mono font-semibold">{fmtMoney(r.total)}</TableCell>
              </TableRow>
            ))}
            {rows.length ? (
              <TableRow className="font-bold border-t-2">
                <TableCell>Totals</TableCell>
                {BUCKETS.map((b) => <TableCell key={b.key} className="text-right font-mono">{fmtMoney(totals[b.key])}</TableCell>)}
                <TableCell className="text-right font-mono">{fmtMoney(totals.total)}</TableCell>
              </TableRow>
            ) : null}
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
