import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Calculator, ExternalLink } from "lucide-react";
import { Link } from "@/lib/router";

type PreviewRow = {
  gate_in: number;
  storage: number;
  storage_days: number;
  handling: number;
  repat_fee: number;
  currency: string;
  owner: string;
  already_invoiced: boolean;
};

type Props = {
  repatriationId: string | null;
  repatriationNumber?: string;
  onOpenChange: (open: boolean) => void;
  onCompleteAndBill?: () => void;
  isCompleting?: boolean;
  canComplete?: boolean;
};

export function RepatriationBillPreviewDialog({
  repatriationId,
  repatriationNumber,
  onOpenChange,
  onCompleteAndBill,
  isCompleting,
  canComplete,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["repatriation-bill-preview", repatriationId],
    enabled: !!repatriationId,
    queryFn: async (): Promise<PreviewRow | null> => {
      const { data, error } = await supabase.rpc(
        "preview_repatriation_bill" as any,
        { _repatriation_id: repatriationId },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as PreviewRow) ?? null;
    },
  });

  const fmt = (n: number) =>
    n > 0 ? `${data?.currency ?? ""} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

  const total = data ? Number(data.repat_fee) : 0;

  return (
    <Dialog open={!!repatriationId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" /> Repatriation bill preview
            {repatriationNumber && <span className="ml-1 font-mono text-sm text-muted-foreground">{repatriationNumber}</span>}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-4"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-3/4" /><Skeleton className="h-6 w-full" /></div>
        ) : !data ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing to preview — the repatriation has no linked container.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Bill to</div>
                <div className="font-medium">{data.owner || <span className="text-destructive">Owner missing</span>}</div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Currency</div>
                <Badge variant="outline" className="font-mono">{data.currency}</Badge>
              </div>
            </div>

            {data.already_invoiced && (
              <div className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm text-info flex items-center justify-between">
                <span>Already invoiced.</span>
                <Link to="/billing/invoices" className="underline inline-flex items-center gap-1">
                  Open invoice <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            )}

            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              This preview is transport only. Repatriation handling is billed separately at USD 30 per container.
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow><TableCell>Repatriation transport</TableCell><TableCell className="text-right font-mono">{fmt(Number(data.repat_fee))}</TableCell></TableRow>
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{total > 0 ? `${data.currency} ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            {total <= 0 && (
              <p className="text-xs text-muted-foreground">No transport amount is set. Apply a route rate or enter the repatriation charge before completing.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canComplete && data && !data.already_invoiced && total > 0 && onCompleteAndBill && (
            <Button onClick={onCompleteAndBill} disabled={isCompleting}>
              {isCompleting ? "Completing…" : "Complete & bill"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
