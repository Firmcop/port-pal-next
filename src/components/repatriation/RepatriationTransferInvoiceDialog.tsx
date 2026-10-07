import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Truck } from "lucide-react";
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

/** Bills the editable Mombasa → Nairobi pre-leg transfer fee, one editable line per container. */
export function RepatriationTransferInvoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [bulk, setBulk] = useState("320");
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const preview = useQuery({
    queryKey: ["repatriation-transfer-preview"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_repatriation_transfer_invoice" as any, {
        _repatriation_ids: null,
        _customer_name: "JJ MES DMCC",
        _amount: null,
      });
      if (error) throw error;
      return (data ?? []) as PreviewRow[];
    },
  });

  const rows = preview.data ?? [];
  const eligible = rows.filter((row) => row.eligible);

  useEffect(() => {
    if (preview.data) {
      setAmounts(Object.fromEntries(preview.data.filter((r) => r.eligible).map((r) => [r.repatriation_id, String(Number(r.amount) || 320)])));
    }
  }, [preview.data]);

  const amountFor = (id: string) => Number(amounts[id]) || 0;
  const total = eligible.reduce((sum, row) => sum + amountFor(row.repatriation_id), 0);
  const invalid = eligible.some((row) => !(amountFor(row.repatriation_id) > 0));

  const generate = async () => {
    const { data, error } = await supabase.rpc("generate_repatriation_transfer_invoice" as any, {
      _repatriation_ids: eligible.map((row) => row.repatriation_id),
      _customer_name: "JJ MES DMCC",
      _amount: null,
      _currency: "USD",
      _amounts: eligible.map((row) => amountFor(row.repatriation_id)),
    });
    if (error) return toast.error(error.message);
    const result = Array.isArray(data) ? data[0] : data;
    toast.success(`${result?.invoice_number ?? "Transfer invoice"} created for USD ${Number(result?.total_amount ?? total).toFixed(2)}`);
    qc.invalidateQueries({ queryKey: ["repatriations"] });
    qc.invalidateQueries({ queryKey: ["repatriation-transfer-preview"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> Mombasa → Nairobi transfer invoice</DialogTitle>
        </DialogHeader>
        {preview.isLoading ? <Skeleton className="h-48 w-full" /> : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border p-3 text-sm">
              <div className="space-y-1">
                <Label htmlFor="transfer-fee">Set all to (USD)</Label>
                <div className="flex gap-2">
                  <Input id="transfer-fee" type="number" step="0.01" className="w-32" value={bulk} onChange={(e) => setBulk(e.target.value)} />
                  <Button
                    variant="outline"
                    disabled={!(Number(bulk) > 0)}
                    onClick={() => setAmounts(Object.fromEntries(eligible.map((r) => [r.repatriation_id, bulk])))}
                  >
                    Apply to all
                  </Button>
                </div>
              </div>
              <div className="text-right">
                <div>{eligible.length} eligible container{eligible.length === 1 ? "" : "s"}</div>
                <div className="font-mono font-semibold">USD {total.toFixed(2)}</div>
              </div>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Repatriation</TableHead><TableHead>Container</TableHead><TableHead>Status</TableHead><TableHead>Billing</TableHead><TableHead className="text-right">Fee (USD)</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((row) => (
                <TableRow key={row.repatriation_id}>
                  <TableCell className="font-mono text-xs">{row.repatriation_number}</TableCell>
                  <TableCell className="font-mono text-xs">{row.container_number}</TableCell>
                  <TableCell className="capitalize">{row.status}</TableCell>
                  <TableCell>{row.eligible ? <Badge variant="outline" className="text-success">Eligible</Badge> : <span className="text-xs text-muted-foreground">{row.exclusion_reason}</span>}</TableCell>
                  <TableCell className="text-right">
                    {row.eligible ? (
                      <Input
                        type="number"
                        step="0.01"
                        className="ml-auto w-28 text-right font-mono"
                        value={amounts[row.repatriation_id] ?? ""}
                        onChange={(e) => setAmounts((a) => ({ ...a, [row.repatriation_id]: e.target.value }))}
                      />
                    ) : (
                      <span className="font-mono text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={generate} disabled={!eligible.length || invalid}>
            <Truck className="mr-2 h-4 w-4" /> Generate USD {total.toFixed(2)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

