import { useMemo, useState } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarDays, Download, FileSpreadsheet, ClipboardList, PlayCircle, History } from "lucide-react";
import { exportCSV, exportPDF } from "@/lib/export-utils";
import { format } from "date-fns";
import { PayrollRunDialog } from "@/components/hrm/PayrollRunDialog";
import { PayrollRunHistorySheet } from "@/components/hrm/PayrollRunHistorySheet";
import { useOrganization } from "@/hooks/use-organization";

const statusColor: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  posted: "bg-info/15 text-info",
  paid: "bg-success/15 text-success",
  void: "bg-destructive/15 text-destructive",
};

function periodToRange(p: string) {
  const [y, m] = p.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export default function HRMPayrollRuns() {
  const navigate = useNavigate();
  const today = new Date();
  const [period, setPeriod] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const [division, setDivision] = useState<string>("all");
  const [runDlg, setRunDlg] = useState(false);
  const [historyRunId, setHistoryRunId] = useState<string | null>(null);
  const org = useOrganization();

  const { start, end } = periodToRange(period);

  const { data: history = [] } = useQuery({
    queryKey: ["payroll-runs-history", org.organizationId],
    enabled: !!org.organizationId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("payroll_runs")
        .select("id,status,period_start,period_end,division,total_payslips,posted_count,pending_approval_count,failed_count,started_at,completed_at")
        .order("started_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const { data: payslips = [], isLoading } = useQuery({
    queryKey: ["payroll-run", start, end],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payslips")
        .select("*, employee:employees(id,name,code,division)")
        .in("status", ["posted", "paid"])
        .gte("pay_date", start)
        .lte("pay_date", end)
        .order("pay_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const divisions = useMemo(() => {
    const set = new Set<string>();
    payslips.forEach((p: any) => p.employee?.division && set.add(p.employee.division));
    return Array.from(set);
  }, [payslips]);

  const filtered = useMemo(
    () => payslips.filter((p: any) => division === "all" || p.employee?.division === division),
    [payslips, division]
  );

  const totals = useMemo(() => {
    let gross = 0, deductions = 0, contributions = 0, net = 0;
    const empSet = new Set<string>();
    filtered.forEach((p: any) => {
      gross += Number(p.gross_pay) || 0;
      deductions += Number(p.total_deductions) || 0;
      contributions += Number(p.total_contributions) || 0;
      net += Number(p.net_pay) || 0;
      empSet.add(p.employee_id);
    });
    return { gross, deductions, contributions, net, employees: empSet.size, count: filtered.length };
  }, [filtered]);

  const headers = ["Pay date", "Reference", "Employee", "Code", "Division", "Status", "Gross", "Deductions", "Contributions", "Net"];
  const rows = filtered.map((p: any) => [
    p.pay_date,
    p.reference,
    p.employee?.name ?? "",
    p.employee?.code ?? "",
    p.employee?.division ?? "",
    p.status,
    Number(p.gross_pay).toFixed(2),
    Number(p.total_deductions).toFixed(2),
    Number(p.total_contributions).toFixed(2),
    Number(p.net_pay).toFixed(2),
  ]);

  const exportName = `payroll-run-${period}${division !== "all" ? "-" + division : ""}`;

  const csv = () => exportCSV(`${exportName}.csv`, headers, rows);
  const pdf = () => exportPDF(`Payroll Run — ${period}${division !== "all" ? " · " + division : ""}`, `${exportName}.pdf`, headers, rows, { landscape: true });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6" />Payroll Runs</h1>
          <p className="text-muted-foreground">Summarize all posted payslips for a pay period and export the results.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setRunDlg(true)}><PlayCircle className="mr-1 h-4 w-4" />Run payroll</Button>
          <Button variant="outline" onClick={csv} disabled={filtered.length === 0}><FileSpreadsheet className="mr-1 h-4 w-4" />Export CSV</Button>
          <Button variant="outline" onClick={pdf} disabled={filtered.length === 0}><Download className="mr-1 h-4 w-4" />Export PDF</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />Period</Label>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-[180px]" />
          </div>
          <div className="space-y-1">
            <Label>Division</Label>
            <Select value={division} onValueChange={setDivision}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All divisions</SelectItem>
                {divisions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground ml-auto">{start} → {end}</div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { lbl: "Employees paid", val: totals.employees },
          { lbl: "Payslips", val: totals.count },
          { lbl: "Gross pay", val: totals.gross.toFixed(2) },
          { lbl: "Deductions", val: totals.deductions.toFixed(2) },
          { lbl: "Net pay", val: totals.net.toFixed(2) },
        ].map((c) => (
          <Card key={c.lbl}><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">{c.lbl}</div>
            <div className="text-2xl font-bold font-mono mt-1">{c.val}</div>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Run details ({filtered.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pay date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Division</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
                <TableHead className="text-right">Contributions</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No posted payslips in this period.</TableCell></TableRow>
              ) : filtered.map((p: any) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/hrm/payslips/${p.id}`)}>
                  <TableCell>{p.pay_date}</TableCell>
                  <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                  <TableCell>{p.employee?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.employee?.division ?? "—"}</TableCell>
                  <TableCell><Badge className={statusColor[p.status] ?? ""} variant="secondary">{p.status}</Badge></TableCell>
                  <TableCell className="text-right font-mono">{Number(p.gross_pay).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono">{Number(p.total_deductions).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono">{Number(p.total_contributions).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{Number(p.net_pay).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" />Run history</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Started</TableHead><TableHead>Period</TableHead><TableHead>Division</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Posted</TableHead><TableHead className="text-right">Pending</TableHead>
              <TableHead className="text-right">Failed</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No runs yet.</TableCell></TableRow>
              ) : history.map((r: any) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setHistoryRunId(r.id)}>
                  <TableCell className="text-xs">{format(new Date(r.started_at), "dd MMM HH:mm")}</TableCell>
                  <TableCell className="text-xs">{r.period_start} → {r.period_end}</TableCell>
                  <TableCell className="text-sm">{r.division ?? "All"}</TableCell>
                  <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                  <TableCell className="text-right">{r.total_payslips}</TableCell>
                  <TableCell className="text-right text-success">{r.posted_count}</TableCell>
                  <TableCell className="text-right text-warning">{r.pending_approval_count}</TableCell>
                  <TableCell className="text-right text-destructive">{r.failed_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PayrollRunDialog open={runDlg} onOpenChange={setRunDlg} start={start} end={end}
        division={division === "all" ? null : division} organizationId={org.organizationId}
        onCompleted={(id) => setHistoryRunId(id)} />
      <PayrollRunHistorySheet open={!!historyRunId} onOpenChange={(o) => !o && setHistoryRunId(null)} runId={historyRunId} />
    </div>
  );
}
