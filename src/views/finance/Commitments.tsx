import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoneyCode } from "@/lib/money";
import { exportCSV } from "@/lib/export-utils";
import { CalendarClock, FileDown, Landmark, ReceiptText } from "lucide-react";
import { format, isSameMonth, parseISO } from "date-fns";

type Commitment = {
  kind: string;
  source_id: string;
  title: string;
  due_date: string;
  amount: number | null;
  currency: string;
  status: string;
  days_until: number;
};

export default function Commitments() {
  const [horizon, setHorizon] = useState("30");

  const { data, isLoading } = useQuery<Commitment[]>({
    queryKey: ["commitments-due", horizon],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("commitments_due", { _days: Number(horizon) });
      if (error) throw error;
      return (data ?? []) as Commitment[];
    },
  });

  const groups = useMemo(() => {
    const rows = data ?? [];
    const out: Array<{ month: Date; rows: Commitment[]; total: number; currency?: string }> = [];
    for (const r of rows) {
      const d = parseISO(r.due_date);
      let g = out.find((x) => isSameMonth(x.month, d));
      if (!g) { g = { month: d, rows: [], total: 0, currency: r.currency }; out.push(g); }
      g.rows.push(r);
      g.total += Number(r.amount ?? 0);
    }
    return out;
  }, [data]);

  const overdue = (data ?? []).filter((r) => r.days_until < 0);
  const week = (data ?? []).filter((r) => r.days_until >= 0 && r.days_until <= 7);
  const total = (data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const currency = data?.[0]?.currency;

  const headers = ["Kind", "Commitment", "Due date", "Amount", "Currency", "Status"];
  const exportRows = () =>
    (data ?? []).map((r) => [r.kind, r.title, r.due_date, r.amount != null ? String(r.amount) : "", r.currency, r.status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarClock className="h-6 w-6" />Commitments</h1>
          <p className="text-muted-foreground">Loan instalments and recurring expenses falling due</p>
        </div>
        <div className="flex gap-2">
          <Select value={horizon} onValueChange={setHorizon}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Next 7 days</SelectItem>
              <SelectItem value="30">Next 30 days</SelectItem>
              <SelectItem value="90">Next 90 days</SelectItem>
              <SelectItem value="365">Next 12 months</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" disabled={!data?.length} onClick={() => exportCSV("commitments.csv", headers, exportRows())}>
            <FileDown className="h-4 w-4 mr-1" />CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Overdue</p>
          <p className={`text-xl font-bold ${overdue.length ? "text-destructive" : ""}`}>{overdue.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Due within 7 days</p>
          <p className="text-xl font-bold">{week.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total in window</p>
          <p className="text-xl font-bold">{formatMoneyCode(total, currency)}</p>
        </CardContent></Card>
      </div>

      {isLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : !data?.length ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Nothing falls due in this window</CardContent></Card>
      ) : groups.map((g) => (
        <Card key={g.month.toISOString()}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>{format(g.month, "MMMM yyyy")}</span>
              <span className="text-sm font-normal font-mono text-muted-foreground">{formatMoneyCode(g.total, g.currency)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Due</TableHead>
                  <TableHead>Commitment</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.rows.map((r, i) => (
                  <TableRow key={`${r.kind}-${r.source_id}-${r.due_date}-${i}`}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {format(parseISO(r.due_date), "dd MMM")}
                      <span className={`ml-2 text-xs ${r.days_until < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {r.days_until < 0 ? `${Math.abs(r.days_until)}d late` : `in ${r.days_until}d`}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {r.kind === "loan" ? (
                        <Link to={`/finance/loans/${r.source_id}`} className="hover:underline">{r.title}</Link>
                      ) : (
                        <Link to="/finance/operating-expenses" className="hover:underline">{r.title}</Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="gap-1">
                        {r.kind === "loan" ? <Landmark className="h-3 w-3" /> : <ReceiptText className="h-3 w-3" />}
                        {r.kind === "loan" ? "Loan" : "Recurring"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {r.amount != null ? formatMoneyCode(r.amount, r.currency) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={r.status === "overdue" ? "bg-destructive/15 text-destructive" : ""}>
                        {r.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
