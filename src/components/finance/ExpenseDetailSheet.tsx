import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Paperclip, Trash2, Download, CheckCircle2, XCircle, Send, Clock } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Money } from "@/components/Money";
import {
  deleteExpenseAttachment,
  signedAttachmentUrl,
  uploadExpenseAttachments,
} from "@/lib/expense-attachments";
import { JobCombobox } from "@/components/finance/JobCombobox";

export const approvalBadge = (status?: string | null) => {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    submitted: "bg-warning/15 text-warning",
    approved: "bg-success/15 text-success",
    rejected: "bg-destructive/15 text-destructive",
  };
  return map[status ?? "draft"] ?? "";
};

export function ExpenseDetailSheet({
  expense,
  onOpenChange,
}: {
  expense: any | null;
  onOpenChange: (v: boolean) => void;
}) {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isOwnerOrAdmin } = useUserStaffRole();
  const [files, setFiles] = useState<File[]>([]);
  const [reason, setReason] = useState("");
  const [jobId, setJobId] = useState<string>("");
  const [jobProject, setJobProject] = useState<string | null>(null);

  const id = expense?.id as string | undefined;

  useEffect(() => {
    setJobId((expense?.conversion_id as string) ?? "");
    setJobProject((expense?.project_id as string) ?? null);
  }, [expense?.id, expense?.conversion_id, expense?.project_id]);

  const setJob = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("set_expense_conversion", {
        _expense_id: id,
        _conversion_id: jobId || null,
        _project_id: jobProject,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["operating-expenses"] });
      qc.invalidateQueries({ queryKey: ["opex-audit", id] });
      qc.invalidateQueries({ queryKey: ["conversion-direct-expenses"] });
      qc.invalidateQueries({ queryKey: ["conversion-pending-expenses"] });
      toast({ title: "Job updated" });
    },
    onError: (e: any) => toast({ title: "Could not update job", description: e.message, variant: "destructive" }),
  });

  const { data: attachments } = useQuery({
    queryKey: ["opex-attachments", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operating_expense_attachments")
        .select("*")
        .eq("expense_id", id)
        .order("created_at");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: audit } = useQuery({
    queryKey: ["opex-audit", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("finance_audit_log")
        .select("*")
        .eq("entity_type", "operating_expense")
        .eq("entity_id", id)
        .order("created_at");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: lines } = useQuery({
    queryKey: ["opex-lines", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operating_expense_lines")
        .select("*, gl_accounts(code,name), expense_categories(name), tax_codes(code,rate)")
        .eq("expense_id", id)
        .order("created_at");
      if (error) throw error;
      return data as any[];
    },
  });

  const invalidate = () => {
    ["operating-expenses", "opex-attachments", "opex-audit", "accounting-transactions", "account-balances", "opex-report"].forEach(
      (k) => qc.invalidateQueries({ queryKey: [k] })
    );
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!id || !org.organizationId || !files.length) return;
      await uploadExpenseAttachments(org.organizationId, id, files);
      await (supabase as any).from("finance_audit_log").insert({
        organization_id: org.organizationId,
        entity_type: "operating_expense",
        entity_id: id,
        entity_ref: expense.expense_number,
        action: "attachment_added",
        summary: { files: files.map((f) => f.name) },
      });
    },
    onSuccess: () => {
      setFiles([]);
      invalidate();
      toast({ title: "Attachment uploaded" });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const removeAtt = useMutation({
    mutationFn: async (att: any) => {
      await deleteExpenseAttachment(att);
      await (supabase as any).from("finance_audit_log").insert({
        organization_id: org.organizationId,
        entity_type: "operating_expense",
        entity_id: id,
        entity_ref: expense.expense_number,
        action: "attachment_removed",
        summary: { file: att.file_name },
      });
    },
    onSuccess: () => { invalidate(); toast({ title: "Attachment removed" }); },
    onError: (e: any) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });

  const act = useMutation({
    mutationFn: async (kind: "submit" | "approve" | "reject") => {
      if (kind === "reject" && !reason.trim()) throw new Error("A rejection reason is required");
      const fn =
        kind === "submit" ? "submit_operating_expense"
        : kind === "approve" ? "approve_operating_expense"
        : "reject_operating_expense";
      const args =
        kind === "reject" ? { _expense_id: id, _reason: reason.trim() }
        : kind === "approve" ? { _expense_id: id, _note: null }
        : { _expense_id: id };
      const { error } = await (supabase as any).rpc(fn, args);
      if (error) throw error;
    },
    onSuccess: () => { setReason(""); invalidate(); onOpenChange(false); toast({ title: "Expense updated" }); },
    onError: (e: any) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const openFile = async (path: string) => {
    try {
      const url = await signedAttachmentUrl(path);
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast({ title: "Could not open file", description: e.message, variant: "destructive" });
    }
  };

  const status = expense?.approval_status ?? "draft";
  const canApprove = isOwnerOrAdmin;

  const timeline = useMemo(() => (audit ?? []).map((a) => ({
    action: a.action,
    at: a.created_at,
    note: a.summary?.reason ?? a.summary?.note ?? (a.summary?.files ? a.summary.files.join(", ") : a.summary?.file ?? ""),
  })), [audit]);

  return (
    <Sheet open={!!expense} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {expense && (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{expense.expense_number}</span>
                <Badge variant="secondary" className={approvalBadge(status)}>{status}</Badge>
                <Badge variant="secondary">{expense.status?.replace("_", " ")}</Badge>
              </SheetTitle>
            </SheetHeader>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Date</p>{format(new Date(expense.expense_date), "dd MMM yyyy")}</div>
              <div><p className="text-xs text-muted-foreground">Payee</p>{expense.suppliers?.name ?? expense.payee ?? "—"}</div>
              <div><p className="text-xs text-muted-foreground">Mode</p>{expense.payment_mode}</div>
              <div><p className="text-xs text-muted-foreground">Total</p><span className="font-mono"><Money amount={expense.total_amount} currency={expense.currency} /></span></div>
              {expense.rejection_reason && (
                <div className="col-span-2 text-destructive"><p className="text-xs text-muted-foreground">Rejection reason</p>{expense.rejection_reason}</div>
              )}
            </div>

            <Separator className="my-4" />
            <h3 className="text-sm font-semibold mb-2">Job (conversion)</h3>
            {isOwnerOrAdmin ? (
              <div className="space-y-2">
                <JobCombobox
                  value={jobId}
                  onChange={(id, job) => { setJobId(id); setJobProject(job?.project_id ?? null); }}
                  placeholder="Not charged to a job"
                />
                <p className="text-xs text-muted-foreground">
                  Changing this only moves the cost onto that job's budget — the ledger entries stay untouched, and the change is
                  recorded in the audit trail below.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={setJob.isPending || jobId === (expense.conversion_id ?? "")}
                  onClick={() => setJob.mutate()}
                >
                  {setJob.isPending ? "Saving…" : "Save job"}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {expense.conversion_id ? "Charged to a conversion job." : "Not charged to a job."}
              </p>
            )}

            <Separator className="my-4" />
            <h3 className="text-sm font-semibold mb-2">Lines</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category / account</TableHead>
                  <TableHead>Tax</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lines ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">
                      {l.expense_categories?.name ?? l.gl_accounts?.name}
                      <span className="block font-mono text-[10px] text-muted-foreground">{l.gl_accounts?.code}</span>
                    </TableCell>
                    <TableCell className="text-xs">{l.tax_codes ? `${l.tax_codes.code}` : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs"><Money amount={l.amount} currency={expense.currency} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Separator className="my-4" />
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1"><Paperclip className="h-4 w-4" />Supplier invoices &amp; receipts</h3>
            <div className="space-y-2">
              {!(attachments ?? []).length && <p className="text-xs text-muted-foreground">No attachments yet.</p>}
              {(attachments ?? []).map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-md border p-2 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.file_name}</p>
                    <p className="text-muted-foreground">{a.label} · {format(new Date(a.created_at), "dd MMM yyyy HH:mm")}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openFile(a.storage_path)}><Download className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => removeAtt.mutate(a)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
              <div className="grid gap-2">
                <Label className="text-xs">Add files</Label>
                <Input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
                <Button size="sm" disabled={!files.length || upload.isPending} onClick={() => upload.mutate()}>
                  {upload.isPending ? "Uploading…" : `Upload ${files.length || ""}`}
                </Button>
              </div>
            </div>

            <Separator className="my-4" />
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1"><Clock className="h-4 w-4" />Audit trail</h3>
            <div className="space-y-2">
              {timeline.map((t, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <Badge variant="outline" className="shrink-0">{t.action.replace("_", " ")}</Badge>
                  <div>
                    <p className="text-muted-foreground">{format(new Date(t.at), "dd MMM yyyy HH:mm")}</p>
                    {t.note && <p>{String(t.note)}</p>}
                  </div>
                </div>
              ))}
              {!timeline.length && <p className="text-xs text-muted-foreground">No events recorded.</p>}
            </div>

            <Separator className="my-4" />
            <div className="space-y-2">
              {(status === "draft" || status === "rejected") && (
                <Button className="w-full" onClick={() => act.mutate("submit")} disabled={act.isPending}>
                  <Send className="h-4 w-4 mr-1" />Submit for approval
                </Button>
              )}
              {status === "submitted" && canApprove && (
                <>
                  <Button className="w-full" onClick={() => act.mutate("approve")} disabled={act.isPending}>
                    <CheckCircle2 className="h-4 w-4 mr-1" />Approve &amp; post to ledger
                  </Button>
                  <Textarea rows={2} placeholder="Rejection reason…" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button variant="destructive" className="w-full" onClick={() => act.mutate("reject")} disabled={act.isPending}>
                    <XCircle className="h-4 w-4 mr-1" />Reject
                  </Button>
                </>
              )}
              {status === "submitted" && !canApprove && (
                <p className="text-xs text-muted-foreground text-center">Awaiting approval by a finance approver.</p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
