import { useState } from "react";
import { useNavigate, useParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Plus, Trash2, Download, Send, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { downloadPayslipPdf } from "@/lib/payslip-pdf";
import { usePayslipPdfSettings } from "@/hooks/use-payslip-pdf-settings";
import { PayslipApprovalDialog } from "@/components/hrm/PayslipApprovalDialog";

const statusColor: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  posted: "bg-info/15 text-info",
  paid: "bg-success/15 text-success",
  void: "bg-destructive/15 text-destructive",
};

const approvalColor: Record<string, string> = {
  not_required: "bg-muted text-muted-foreground",
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
};

const LINE_TYPES = [
  { value: "earning", label: "Earning" },
  { value: "deduction", label: "Deduction" },
  { value: "contribution", label: "Contribution" },
];

// PAYE, NSSF, SHIF and Housing Levy are calculated by the database from the earnings.
const STATUTORY = ["PAYE", "NSSF", "SHIF", "AHL", "NSSF_ER", "AHL_ER"];

export default function HRMPayslipDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isAdmin } = useUserStaffRole();
  const [newLine, setNewLine] = useState({ line_type: "earning", label: "", amount: "0" });
  const [payAccount, setPayAccount] = useState<string>("");
  const [approvalDlg, setApprovalDlg] = useState<{ open: boolean; action: "approve" | "reject" }>({ open: false, action: "approve" });

  const { data: payslip } = useQuery({
    queryKey: ["hrm-payslip", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payslips")
        .select("*, employee:employees(id,name,code,email,role,division,tax_id)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ["hrm-payslip-lines", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payslip_lines")
        .select("*")
        .eq("payslip_id", id)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: pdfSettings } = usePayslipPdfSettings();

  const { data: org } = useQuery({
    queryKey: ["hrm-org-config-for-payslip"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("organizations").select("name,config,tax_id,billing_address").maybeSingle();
      if (error) return null;
      return data;
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["hrm-fa"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("financial_accounts").select("id,name").eq("is_active", true).order("name");
      if (error) return [];
      return data ?? [];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["hrm-payslip", id] });
    qc.invalidateQueries({ queryKey: ["hrm-payslip-lines", id] });
  };

  const addLine = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("payslip_lines").insert({
        payslip_id: id,
        line_type: newLine.line_type,
        label: newLine.label,
        amount: parseFloat(newLine.amount) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => { setNewLine({ line_type: "earning", label: "", amount: "0" }); refresh(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteLine = useMutation({
    mutationFn: async (lineId: string) => {
      const { error } = await (supabase as any).from("payslip_lines").delete().eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("submit_payslip_for_approval", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Submitted for approval" }); refresh(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const post = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("post_payslip", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Payslip posted" }); refresh(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pay = useMutation({
    mutationFn: async () => {
      if (!payAccount) throw new Error("Pick a payment account");
      const { error } = await (supabase as any).rpc("pay_payslip", { _id: id, _from_account_id: payAccount });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Payslip marked paid" }); refresh(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const voidIt = useMutation({
    mutationFn: async () => {
      const reason = prompt("Reason for voiding?") ?? "";
      const { error } = await (supabase as any).rpc("void_payslip", { _id: id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Payslip voided" }); refresh(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handlePdf = () => {
    if (!payslip) return;
    downloadPayslipPdf({
      reference: payslip.reference,
      status: payslip.status,
      pay_date: payslip.pay_date,
      period_start: payslip.period_start,
      period_end: payslip.period_end,
      description: payslip.description,
      gross_pay: payslip.gross_pay,
      total_deductions: payslip.total_deductions,
      total_contributions: payslip.total_contributions,
      net_pay: payslip.net_pay,
      employee: payslip.employee ?? { name: "—" },
      organization: { name: org?.name, tax_id: org?.tax_id, address: typeof org?.billing_address === "string" ? org.billing_address : null },
      lines,
      approval: payslip.approved_at
        ? { approver: null, approved_at: payslip.approved_at, comment: payslip.approval_comment }
        : null,
      settings: pdfSettings ?? undefined,
    });
  };

  if (!payslip) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const editable = payslip.status === "draft" && payslip.approval_status !== "pending";
  const requireApproval = !!org?.config?.payslip_requires_approval;
  const canPost = payslip.status === "draft" && (!requireApproval || payslip.approval_status === "approved");

  const grouped = {
    earning: lines.filter((l: any) => l.line_type === "earning"),
    deduction: lines.filter((l: any) => l.line_type === "deduction"),
    contribution: lines.filter((l: any) => l.line_type === "contribution"),
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/hrm/payslips")}><ArrowLeft className="mr-1 h-4 w-4" />Back to Payslips</Button>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 flex-wrap">
              {payslip.reference}
              <Badge className={statusColor[payslip.status] ?? ""} variant="secondary">{payslip.status}</Badge>
              {payslip.approval_status && payslip.approval_status !== "not_required" && (
                <Badge className={approvalColor[payslip.approval_status]} variant="secondary">{payslip.approval_status}</Badge>
              )}
            </CardTitle>
            <div className="text-sm text-muted-foreground mt-1">
              {payslip.employee?.name} · {payslip.period_start} → {payslip.period_end}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <Button variant="outline" size="sm" onClick={handlePdf}><Download className="mr-1 h-4 w-4" />Download PDF</Button>
            {payslip.status === "draft" && payslip.approval_status !== "pending" && payslip.approval_status !== "approved" && (
              <Button size="sm" variant="outline" onClick={() => submit.mutate()} disabled={submit.isPending || lines.length === 0}>
                <Send className="mr-1 h-4 w-4" />Submit for approval
              </Button>
            )}
            {payslip.approval_status === "pending" && isAdmin && (
              <>
                <Button size="sm" variant="outline" onClick={() => setApprovalDlg({ open: true, action: "approve" })}>
                  <CheckCircle2 className="mr-1 h-4 w-4" />Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setApprovalDlg({ open: true, action: "reject" })}>
                  <XCircle className="mr-1 h-4 w-4" />Reject
                </Button>
              </>
            )}
            {payslip.status === "draft" && (
              <Button size="sm" onClick={() => post.mutate()} disabled={post.isPending || lines.length === 0 || !canPost}>Post</Button>
            )}
            {payslip.status === "posted" && (
              <div className="flex gap-2">
                <Select value={payAccount} onValueChange={setPayAccount}>
                  <SelectTrigger className="w-[180px]"><SelectValue placeholder="Pay from account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={() => pay.mutate()} disabled={pay.isPending || !payAccount}>Mark Paid</Button>
              </div>
            )}
            {payslip.status !== "void" && payslip.status !== "paid" && (
              <Button variant="outline" size="sm" onClick={() => voidIt.mutate()} disabled={voidIt.isPending}>Void</Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><div className="text-xs text-muted-foreground">Pay date</div><div>{payslip.pay_date}</div></div>
          <div><div className="text-xs text-muted-foreground">Gross pay</div><div className="font-mono font-semibold">{Number(payslip.gross_pay).toFixed(2)}</div></div>
          <div><div className="text-xs text-muted-foreground">Deductions</div><div className="font-mono">{Number(payslip.total_deductions).toFixed(2)}</div></div>
          <div><div className="text-xs text-muted-foreground">Contributions</div><div className="font-mono">{Number(payslip.total_contributions).toFixed(2)}</div></div>
          <div className="col-span-2"><div className="text-xs text-muted-foreground">Description</div><div>{payslip.description ?? "—"}</div></div>
          <div className="col-span-2 md:col-span-2"><div className="text-xs text-muted-foreground">Net pay</div><div className="font-mono text-lg font-bold">{Number(payslip.net_pay).toFixed(2)}</div></div>
        </CardContent>
      </Card>

      {payslip.approval_status === "pending" && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="p-4 text-sm">
            <div className="font-medium">Awaiting manager approval</div>
            <div className="text-muted-foreground text-xs mt-1">
              Submitted {payslip.submitted_for_approval_at ? new Date(payslip.submitted_for_approval_at).toLocaleString() : ""}
              {!isAdmin && " · only an admin can approve or reject"}
            </div>
          </CardContent>
        </Card>
      )}

      {payslip.approval_status === "approved" && payslip.approved_at && (
        <Card className="border-success/50 bg-success/5">
          <CardContent className="p-4 text-sm">
            <div className="font-medium">Approved {new Date(payslip.approved_at).toLocaleString()}</div>
            {payslip.approval_comment && <div className="text-muted-foreground mt-1">“{payslip.approval_comment}”</div>}
          </CardContent>
        </Card>
      )}

      {payslip.approval_status === "rejected" && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            <div className="font-medium">Rejected — returned for editing</div>
            {payslip.approval_comment && <div className="text-muted-foreground mt-1">“{payslip.approval_comment}”</div>}
          </CardContent>
        </Card>
      )}

      {(["earning","deduction","contribution"] as const).map((type) => (
        <Card key={type}>
          <CardHeader><CardTitle className="capitalize text-base">{type}s</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped[type].length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground text-sm">No {type} lines.</TableCell></TableRow>
                ) : grouped[type].map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      {l.label}
                      {STATUTORY.includes(l.code) && <span className="ml-2 text-xs text-muted-foreground">auto</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{Number(l.amount).toFixed(2)}</TableCell>
                    <TableCell>
                      {editable && !STATUTORY.includes(l.code) && <Button variant="ghost" size="icon" onClick={() => deleteLine.mutate(l.id)}><Trash2 className="h-4 w-4" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {editable && (
        <Card>
          <CardHeader><CardTitle className="text-base">Add line</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Type</div>
                <Select value={newLine.line_type} onValueChange={(v) => setNewLine({ ...newLine, line_type: v })}>
                  <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{LINE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1 flex-1 min-w-[200px]">
                <div className="text-xs text-muted-foreground">Label</div>
                <Input placeholder="e.g. Basic salary, PAYE, NSSF" value={newLine.label} onChange={(e) => setNewLine({ ...newLine, label: e.target.value })} />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Amount</div>
                <Input type="number" step="0.01" value={newLine.amount} onChange={(e) => setNewLine({ ...newLine, amount: e.target.value })} />
              </div>
              <Button onClick={() => addLine.mutate()} disabled={addLine.isPending || !newLine.label}><Plus className="mr-1 h-4 w-4" />Add</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <PayslipApprovalDialog
        open={approvalDlg.open}
        action={approvalDlg.action}
        payslipId={id!}
        onOpenChange={(v) => setApprovalDlg((s) => ({ ...s, open: v }))}
        onDone={refresh}
      />
    </div>
  );
}
