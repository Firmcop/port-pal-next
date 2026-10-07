import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatMoneyCode } from "@/lib/money";
import { ShieldCheck, Check, X } from "lucide-react";

type DocType = "contra_settlement" | "payment_allocation";

const LABEL: Record<string, string> = {
  contra_settlement: "Set-off",
  payment_allocation: "Payment allocation",
};

/**
 * Queue of finance approvals awaiting a decision: above-threshold set-offs and
 * lump-sum payment allocations that deviate from the proposed oldest-first split.
 */
export function FinanceApprovalsPanel({ docTypes }: { docTypes?: DocType[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const types = docTypes ?? (["contra_settlement", "payment_allocation"] as DocType[]);

  const { data: requests } = useQuery({
    queryKey: ["finance-approvals", types.join(",")],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("approval_requests")
        .select("*")
        .in("doc_type", types)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const ids = (requests ?? []).map((r) => r.id);

  const { data: details } = useQuery({
    queryKey: ["finance-approval-details", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const [contra, alloc] = await Promise.all([
        (supabase as any).from("contra_settlements").select("*").in("approval_request_id", ids),
        (supabase as any).from("payment_allocation_requests").select("*").in("approval_request_id", ids),
      ]);
      const map: Record<string, any> = {};
      (contra.data ?? []).forEach((c: any) => { map[c.approval_request_id] = { kind: "contra", row: c }; });
      (alloc.data ?? []).forEach((a: any) => { map[a.approval_request_id] = { kind: "alloc", row: a }; });
      return map;
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => {
      const note = window.prompt(decision === "approved" ? "Approval note (optional)" : "Reason for rejection");
      if (decision === "rejected" && !note) throw new Error("A reason is required to reject");
      const { data, error } = await (supabase as any).rpc("decide_finance_approval", {
        _request_id: id, _decision: decision, _note: note || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      ["finance-approvals", "finance-approval-details", "contra-settlements", "contra-preview",
        "vendor-payments", "supplier-invoices", "counterparty-reconciliation", "finance-dashboard-metrics"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast({ title: v.decision === "approved" ? "Approved and posted" : "Request rejected" });
    },
    onError: (e: any) => toast({ title: "Decision failed", description: e.message, variant: "destructive" }),
  });

  if (!requests?.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Awaiting finance approval</CardTitle>
        <CardDescription>Set-offs above the policy threshold and manual allocation overrides post only once approved.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Raised</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r: any) => {
                const d = details?.[r.id];
                const row = d?.row;
                const currency = row?.currency ?? "";
                return (
                  <TableRow key={r.id}>
                    <TableCell><Badge variant="outline">{LABEL[r.doc_type] ?? r.doc_type}</Badge></TableCell>
                    <TableCell className="text-sm">{row?.counterparty_name ?? row?.supplier_id ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatMoneyCode(Number(r.amount ?? row?.amount ?? 0), currency)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[320px]">
                      {d?.kind === "contra"
                        ? `Set-off ${row?.settlement_number ?? ""} · evidence ${row?.evidence_ref || "not supplied"}`
                        : d?.kind === "alloc"
                          ? `${(row?.requested_allocations ?? []).length} invoice line(s) · ${row?.deviates_from_proposal ? "deviates from oldest-first proposal" : "matches proposal"}${row?.reason ? ` · ${row.reason}` : ""}`
                          : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: r.id, decision: "approved" })}>
                        <Check className="h-4 w-4 mr-1" />Approve
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: r.id, decision: "rejected" })}>
                        <X className="h-4 w-4 mr-1" />Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default FinanceApprovalsPanel;
