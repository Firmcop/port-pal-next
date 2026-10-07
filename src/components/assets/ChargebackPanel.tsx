import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtMoney } from "@/lib/finance-format";
import { useToast } from "@/hooks/use-toast";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { CheckCircle2, XCircle, Ban, Wallet, Send, ShieldCheck } from "lucide-react";

type Props = {
  issue: any;
  onChanged?: () => void;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  none: "outline",
  pending_approval: "default",
  approved: "secondary",
  rejected: "destructive",
  invoiced: "secondary",
  partially_paid: "secondary",
  paid: "secondary",
  waived: "outline",
};

const STATUS_LABEL: Record<string, string> = {
  none: "No chargeback",
  pending_approval: "Pending approval",
  approved: "Approved · unpaid",
  rejected: "Rejected",
  invoiced: "Invoiced",
  partially_paid: "Partially paid",
  paid: "Paid in full",
  waived: "Waived",
};

export function ChargebackPanel({ issue, onChanged }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isOwnerOrAdmin, role } = useUserStaffRole();
  const canApprove = isOwnerOrAdmin || role === "accountant" || role === "asset_manager";
  const canWaive = isOwnerOrAdmin;

  const [submitOpen, setSubmitOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState<null | "approve" | "reject" | "waive">(null);
  const [payOpen, setPayOpen] = useState(false);

  const { data: payments = [] } = useQuery({
    queryKey: ["asset-cb-payments", issue?.id],
    enabled: !!issue?.id,
    queryFn: async () =>
      (await supabase.from("asset_chargeback_payments" as any)
        .select("*").eq("issue_id", issue.id).order("paid_at", { ascending: false })).data ?? [],
  });

  const status: string = issue?.chargeback_status ?? "none";
  const amount = Number(issue?.damage_charge_amount || 0);
  const paid = Number(issue?.chargeback_amount_paid || 0);
  const balance = Math.max(0, amount - paid);
  const eligible = issue?.status === "damaged" || issue?.status === "lost";

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["asset-issues", issue.asset_id] });
    qc.invalidateQueries({ queryKey: ["asset-issues-all"] });
    qc.invalidateQueries({ queryKey: ["asset-cb-payments", issue.id] });
    onChanged?.();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Chargeback
              <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status] ?? status}</Badge>
            </CardTitle>
            <div className="text-xs text-muted-foreground mt-1">
              Holder: {issue.emp?.name || issue.cust?.name || issue.issued_to_name || "—"}
              {issue.chargeback_submitted_at && <> · Submitted {new Date(issue.chargeback_submitted_at).toLocaleString()}</>}
              {issue.chargeback_decided_at && <> · Decided {new Date(issue.chargeback_decided_at).toLocaleString()}</>}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {eligible && (status === "none" || status === "rejected") && (
              <Button size="sm" onClick={() => setSubmitOpen(true)}><Send className="h-4 w-4 mr-1" />Submit for approval</Button>
            )}
            {status === "pending_approval" && canApprove && (
              <>
                <Button size="sm" onClick={() => setDecisionOpen("approve")}><CheckCircle2 className="h-4 w-4 mr-1" />Approve</Button>
                <Button size="sm" variant="destructive" onClick={() => setDecisionOpen("reject")}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
              </>
            )}
            {["approved","invoiced","partially_paid"].includes(status) && (
              <Button size="sm" onClick={() => setPayOpen(true)} disabled={balance <= 0}><Wallet className="h-4 w-4 mr-1" />Record payment</Button>
            )}
            {["pending_approval","approved","invoiced","partially_paid"].includes(status) && canWaive && (
              <Button size="sm" variant="outline" onClick={() => setDecisionOpen("waive")}><Ban className="h-4 w-4 mr-1" />Waive</Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "none" && (
          <div className="text-sm text-muted-foreground">
            {eligible
              ? "No chargeback recorded yet. Submit one for approval to charge the holder."
              : "Chargebacks apply only to damaged or lost issues."}
          </div>
        )}
        {status !== "none" && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Metric label="Amount" value={fmtMoney(amount)} />
            <Metric label="Paid" value={fmtMoney(paid)} />
            <Metric label={balance > 0 ? "Balance" : "Settled"} value={fmtMoney(balance)} highlight={balance > 0} />
            <Metric label="Currency" value={issue.currency || "—"} />
          </div>
        )}
        {issue.chargeback_decision_notes && (
          <div className="text-xs bg-muted/40 p-2 rounded">
            <span className="uppercase tracking-wide text-muted-foreground">Notes:</span> {issue.chargeback_decision_notes}
          </div>
        )}

        {payments.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-2">Payments</div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Method</TableHead>
                <TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {payments.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs">{new Date(p.paid_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-xs">{p.method}</TableCell>
                    <TableCell className="text-xs">{p.reference || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmtMoney(p.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <SubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        issue={issue}
        onDone={() => { setSubmitOpen(false); refresh(); toast({ title: "Submitted for approval" }); }}
      />
      <DecisionDialog
        open={!!decisionOpen}
        action={decisionOpen}
        onOpenChange={(v) => !v && setDecisionOpen(null)}
        issue={issue}
        onDone={(label) => { setDecisionOpen(null); refresh(); toast({ title: label }); }}
      />
      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        issue={issue}
        balance={balance}
        onDone={() => { setPayOpen(false); refresh(); toast({ title: "Payment recorded" }); }}
      />
    </Card>
  );
}

function Metric({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono ${highlight ? "text-destructive font-semibold" : ""}`}>{value}</div>
    </div>
  );
}

function SubmitDialog({ open, onOpenChange, issue, onDone }: any) {
  const { toast } = useToast();
  const [amount, setAmount] = useState<number>(Number(issue?.damage_charge_amount || 0));
  const [notes, setNotes] = useState("");
  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("submit_asset_chargeback" as any, {
        p_issue_id: issue.id, p_amount: amount, p_notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => onDone(),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Submit chargeback for approval</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Amount ({issue?.currency || "—"})</Label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </div>
          <div><Label>Justification / notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Describe damage or loss circumstances…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || amount <= 0}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecisionDialog({ open, onOpenChange, action, issue, onDone }: any) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const title = action === "approve" ? "Approve chargeback" : action === "reject" ? "Reject chargeback" : "Waive chargeback";
  const need = action !== "approve";
  const mut = useMutation({
    mutationFn: async () => {
      const fn = action === "approve" ? "approve_asset_chargeback"
        : action === "reject" ? "reject_asset_chargeback" : "waive_asset_chargeback";
      const args: any = action === "approve"
        ? { p_issue_id: issue.id, p_notes: notes || null }
        : { p_issue_id: issue.id, p_reason: notes };
      const { error } = await supabase.rpc(fn as any, args);
      if (error) throw error;
    },
    onSuccess: () => {
      setNotes("");
      onDone(action === "approve" ? "Chargeback approved · posted to ledger" : action === "reject" ? "Chargeback rejected" : "Chargeback waived");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm bg-muted/40 p-3 rounded">
            {issue?.emp?.name || issue?.cust?.name || issue?.issued_to_name || "Holder"} · {fmtMoney(issue?.damage_charge_amount)} {issue?.currency || ""}
          </div>
          <div>
            <Label>{action === "approve" ? "Notes (optional)" : "Reason"} {need && <span className="text-destructive">*</span>}</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => mut.mutate()}
            variant={action === "reject" ? "destructive" : "default"}
            disabled={mut.isPending || (need && !notes.trim())}
          >Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ open, onOpenChange, issue, balance, onDone }: any) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({ amount: balance, method: "cash", reference: "", notes: "", paid_at: new Date().toISOString().slice(0, 10) });
  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("record_asset_chargeback_payment" as any, {
        p_issue_id: issue.id,
        p_amount: form.amount,
        p_method: form.method,
        p_reference: form.reference || null,
        p_notes: form.notes || null,
        p_paid_at: new Date(form.paid_at).toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => onDone(),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record chargeback payment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm bg-muted/40 p-3 rounded">
            Balance outstanding: <span className="font-mono font-semibold">{fmtMoney(balance)}</span> {issue?.currency}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Amount</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></div>
            <div><Label>Date</Label><Input type="date" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} /></div>
          </div>
          <div>
            <Label>Method</Label>
            <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["cash","bank_transfer","mobile_money","cheque","payroll_deduction","other"].map((m) => (
                  <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Reference</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Receipt no, txn id…" /></div>
          <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || form.amount <= 0 || form.amount > balance + 0.001}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
