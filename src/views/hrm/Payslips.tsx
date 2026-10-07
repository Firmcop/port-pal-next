import { useState, useMemo } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Receipt, Search, Download, CalendarRange } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PayslipDialog } from "@/components/hrm/PayslipDialog";
import { downloadPayslipPdf, downloadPayslipBatchPdf } from "@/lib/payslip-pdf";
import { usePayslipPdfSettings } from "@/hooks/use-payslip-pdf-settings";

const statusColor: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  posted: "bg-info/15 text-info",
  paid: "bg-success/15 text-success",
  void: "bg-destructive/15 text-destructive",
};

export default function HRMPayslips() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [summaryMonth, setSummaryMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const generateSummaries = async () => {
    setGenerating(true);
    const { data, error } = await (supabase as any).rpc("generate_monthly_wage_payslips", { _month_start: `${summaryMonth}-01` });
    setGenerating(false);
    if (error) { toast({ title: "Could not generate", description: error.message, variant: "destructive" }); return; }
    toast({ title: data ? `${data} wage summary payslip(s) created` : "Nothing to summarise", description: data ? "Weekly wages already posted — these are summary records only." : "No unsummarised approved weeks in that month." });
    qc.invalidateQueries({ queryKey: ["hrm-payslips"] });
  };

  const { data: payslips = [], isLoading } = useQuery({
    queryKey: ["hrm-payslips"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payslips")
        .select("*, employee:employees(id,name,code,division,tax_id,email), lines:payslip_lines(line_type,label,amount)")
        .order("pay_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: org } = useQuery({
    queryKey: ["hrm-org-info"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("organizations").select("name,tax_id,billing_address").maybeSingle();
      if (error) return null;
      return data;
    },
  });

  const { data: pdfSettings } = usePayslipPdfSettings();

  const toPdfData = (p: any) => ({
    reference: p.reference,
    status: p.status,
    pay_date: p.pay_date,
    period_start: p.period_start,
    period_end: p.period_end,
    description: p.description,
    gross_pay: p.gross_pay,
    total_deductions: p.total_deductions,
    total_contributions: p.total_contributions,
    net_pay: p.net_pay,
    employee: p.employee ?? { name: "—" },
    organization: { name: org?.name, address: typeof org?.billing_address === "string" ? org.billing_address : null, tax_id: org?.tax_id },
    lines: p.lines ?? [],
    settings: pdfSettings ?? undefined,
  });

  const handleDownload = (p: any) => downloadPayslipPdf(toPdfData(p));

  const monthSlips = useMemo(
    () => (payslips as any[]).filter((p: any) => String(p.period_start ?? p.pay_date ?? "").slice(0, 7) === summaryMonth),
    [payslips, summaryMonth],
  );

  const exportRegisterCsv = () => {
    if (monthSlips.length === 0) { toast({ title: "Nothing to export", description: "No payslips in that month." }); return; }
    const rows = [
      ["Reference", "Employee", "Code", "Period start", "Period end", "Pay date", "Gross", "Deductions", "Contributions", "Net", "Status"],
      ...monthSlips.map((p: any) => [
        p.reference, p.employee?.name ?? "", p.employee?.code ?? "", p.period_start, p.period_end, p.pay_date,
        Number(p.gross_pay ?? 0).toFixed(2), Number(p.total_deductions ?? 0).toFixed(2),
        Number(p.total_contributions ?? 0).toFixed(2), Number(p.net_pay ?? 0).toFixed(2), p.status,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-register-${summaryMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAllPdfs = () => {
    if (monthSlips.length === 0) { toast({ title: "Nothing to export", description: "No payslips in that month." }); return; }
    downloadPayslipBatchPdf(monthSlips.map(toPdfData), `Payslips ${summaryMonth}`);
  };


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payslips.filter((p: any) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return [p.reference, p.description, p.employee?.name, p.employee?.code].some((v) => v?.toLowerCase().includes(q));
    });
  }, [payslips, search, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="h-6 w-6" />Payslips</h1>
          <p className="text-muted-foreground">Generate detailed payment records — earnings, deductions, employer contributions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="month" className="w-[150px]" value={summaryMonth} onChange={(e) => setSummaryMonth(e.target.value)} />
          <Button variant="outline" onClick={generateSummaries} disabled={generating}><CalendarRange className="mr-1 h-4 w-4" />Generate wage summaries</Button>
          <Button variant="outline" onClick={exportRegisterCsv}><Download className="mr-1 h-4 w-4" />Register CSV ({monthSlips.length})</Button>
          <Button variant="outline" onClick={exportAllPdfs}><Download className="mr-1 h-4 w-4" />All payslips PDF</Button>
          <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />New Payslip</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search by reference, employee, description" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="posted">Posted</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="void">Void</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Gross pay</TableHead>
                <TableHead className="text-right">Deduction</TableHead>
                <TableHead className="text-right">Net pay</TableHead>
                <TableHead className="text-right">Contribution</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No payslips yet — create your first.</TableCell></TableRow>
              ) : filtered.map((p: any) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/hrm/payslips/${p.id}`)}>
                  <TableCell>{p.pay_date}</TableCell>
                  <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                  <TableCell>{p.employee?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.description ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(p.gross_pay).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono">{Number(p.total_deductions).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{Number(p.net_pay).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono">{Number(p.total_contributions).toFixed(2)}</TableCell>
                  <TableCell><Badge className={statusColor[p.status] ?? ""} variant="secondary">{p.status}</Badge></TableCell>
                  <TableCell onClick={(ev) => ev.stopPropagation()}>
                    <Button size="icon" variant="ghost" title="Download PDF" onClick={() => handleDownload(p)}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PayslipDialog open={open} onOpenChange={setOpen} onCreated={(id) => { qc.invalidateQueries({ queryKey: ["hrm-payslips"] }); navigate(`/hrm/payslips/${id}`); }} />
    </div>
  );
}
