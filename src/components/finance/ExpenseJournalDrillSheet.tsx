import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileDown, Paperclip } from "lucide-react";
import { format } from "date-fns";
import { fmtMoney } from "@/lib/finance-format";
import { exportCSV } from "@/lib/export-utils";
import { signedAttachmentUrl } from "@/lib/expense-attachments";
import { useToast } from "@/hooks/use-toast";

export type DrillTarget = {
  glAccountId: string;
  label: string;
  from?: string;
  to?: string;
  depotId?: string | null;
  projectId?: string | null;
};

/**
 * Shared drill-down: journal lines behind an expense/COGS account for a period,
 * with links to the originating OPEX document and its stored receipts.
 */
export function ExpenseJournalDrillSheet({
  target,
  onOpenChange,
}: {
  target: DrillTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();

  const { data: lines, isLoading } = useQuery({
    queryKey: ["expense-journal-drill", target?.glAccountId, target?.from, target?.to, target?.depotId, target?.projectId],
    enabled: !!target?.glAccountId,
    queryFn: async () => {
      let q = (supabase as any)
        .from("v_expense_journal_lines")
        .select("*")
        .eq("gl_account_id", target!.glAccountId)
        .order("transaction_date", { ascending: false })
        .limit(500);
      if (target!.from) q = q.gte("transaction_date", target!.from);
      if (target!.to) q = q.lte("transaction_date", target!.to);
      if (target!.depotId) q = q.eq("depot_id", target!.depotId);
      if (target!.projectId) q = q.eq("project_id", target!.projectId);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  const expenseIds = Array.from(
    new Set((lines ?? []).filter((l) => l.reference_type === "operating_expense" && l.reference_id).map((l) => l.reference_id))
  );

  const { data: attachments } = useQuery({
    queryKey: ["drill-attachments", expenseIds.join(",")],
    enabled: expenseIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operating_expense_attachments")
        .select("id,expense_id,file_name,storage_path")
        .in("expense_id", expenseIds);
      if (error) throw error;
      return data as any[];
    },
  });

  const attachmentsFor = (expenseId: string) => (attachments ?? []).filter((a) => a.expense_id === expenseId);

  const openAttachment = async (path: string) => {
    try {
      window.open(await signedAttachmentUrl(path, 300), "_blank", "noopener");
    } catch (e: any) {
      toast({ title: "Could not open file", description: e.message, variant: "destructive" });
    }
  };

  const total = (lines ?? []).reduce((s, l) => s + Number(l.debit_amount || 0) - Number(l.credit_amount || 0), 0);

  return (
    <Sheet open={!!target} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{target?.label}</SheetTitle>
        </SheetHeader>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {(lines ?? []).length} journal lines
            {target?.from && target?.to ? ` · ${target.from} → ${target.to}` : ""}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold">{fmtMoney(total)}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={!(lines ?? []).length}
              onClick={() =>
                exportCSV(
                  "expense_drilldown.csv",
                  ["Date", "Entry", "Description", "Source", "Supplier", "Amount"],
                  (lines ?? []).map((l) => [
                    l.transaction_date,
                    l.transaction_number,
                    l.description ?? "",
                    l.expense_number ?? l.reference_type ?? "",
                    l.supplier_name ?? l.payee ?? "",
                    String(Number(l.debit_amount || 0) - Number(l.credit_amount || 0)),
                  ])
                )
              }
            >
              <FileDown className="h-4 w-4 mr-1" />
              CSV
            </Button>
          </div>
        </div>

        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Receipts</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : !(lines ?? []).length ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No journal entries for this selection.
                </TableCell>
              </TableRow>
            ) : (
              (lines ?? []).map((l) => {
                const atts = l.reference_id ? attachmentsFor(l.reference_id) : [];
                return (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(new Date(l.transaction_date), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{l.transaction_number}</TableCell>
                    <TableCell className="text-xs max-w-[220px] truncate">{l.description}</TableCell>
                    <TableCell className="text-xs">
                      {l.expense_number ? (
                        <a className="underline" href="/finance/operating-expenses">{l.expense_number}</a>
                      ) : (
                        l.reference_type ?? "—"
                      )}
                      {(l.supplier_name || l.payee) && (
                        <span className="block text-muted-foreground">{l.supplier_name ?? l.payee}</span>
                      )}
                      {l.approval_status && l.approval_status !== "approved" && (
                        <Badge variant="outline" className="mt-1 text-[10px]">{l.approval_status}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {atts.length ? (
                        <div className="flex flex-col gap-1">
                          {atts.map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => openAttachment(a.storage_path)}
                              className="flex items-center gap-1 underline text-left"
                            >
                              <Paperclip className="h-3 w-3" />
                              <span className="max-w-[120px] truncate">{a.file_name}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtMoney(Number(l.debit_amount || 0) - Number(l.credit_amount || 0), l.currency)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </SheetContent>
    </Sheet>
  );
}
