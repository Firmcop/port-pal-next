import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt } from "lucide-react";
import { toast } from "sonner";

type PreviewRow = {
  repatriation_id: string;
  repatriation_number: string;
  container_number: string;
  status: string;
  eligible: boolean;
  exclusion_reason: string | null;
  amount: number;
  currency: string;
};

export function RepatriationHandlingInvoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ["repatriation-handling-preview"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_repatriation_handling_invoice" as any, {
        _customer_name: "JJ MES DMCC",
        _repatriation_ids: null,
      });
      if (error) throw error;
      return (data ?? []) as PreviewRow[];
    },
  });
  const rows = preview.data ?? [];
  const eligible = rows.filter((row) => row.eligible);
  const total = eligible.reduce((sum, row) => sum + Number(row.amount), 0);

  const generate = async () => {
    const { data, error } = await supabase.rpc("generate_repatriation_handling_invoice" as any, {
      _amount: 30,
      _currency: "USD",
      _customer_name: "JJ MES DMCC",
      _repatriation_ids: eligible.map((row) => row.repatriation_id),
    });
    if (error) return toast.error(error.message);
    const result = Array.isArray(data) ? data[0] : data;
    toast.success(`${result?.invoice_number ?? "Handling invoice"} created for USD ${Number(result?.total_amount ?? total).toFixed(2)}`);
    qc.invalidateQueries({ queryKey: ["repatriations"] });
    qc.invalidateQueries({ queryKey: ["repatriation-handling-preview"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" /> JJ MES DMCC handling invoice</DialogTitle>
        </DialogHeader>
        {preview.isLoading ? <Skeleton className="h-48 w-full" /> : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <span>{eligible.length} eligible repatriation{eligible.length === 1 ? "" : "s"} at USD 30 each</span>
              <span className="font-mono font-semibold">USD {total.toFixed(2)}</span>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Repatriation</TableHead><TableHead>Container</TableHead><TableHead>Status</TableHead><TableHead>Billing</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((row) => (
                <TableRow key={row.repatriation_id}>
                  <TableCell className="font-mono text-xs">{row.repatriation_number}</TableCell>
                  <TableCell className="font-mono text-xs">{row.container_number}</TableCell>
                  <TableCell className="capitalize">{row.status}</TableCell>
                  <TableCell>{row.eligible ? <Badge variant="outline" className="text-success">Eligible</Badge> : <span className="text-xs text-muted-foreground">{row.exclusion_reason}</span>}</TableCell>
                  <TableCell className="text-right font-mono">USD {Number(row.amount).toFixed(2)}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={generate} disabled={!eligible.length}><Receipt className="mr-2 h-4 w-4" /> Generate USD {total.toFixed(2)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}