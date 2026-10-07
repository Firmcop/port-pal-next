import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

type Line = {
  repatriation_id: string;
  repatriation_number: string | null;
  container_number: string | null;
  amount: number;
  currency: string | null;
};

/** Admin edit of per-container Mombasa → Nairobi transfer fees on an existing RPT- invoice. */
export function EditTransferFeesDialog({
  invoice,
  onOpenChange,
}: {
  invoice: { id: string; invoice_number: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const lines = useQuery({
    queryKey: ["transfer-invoice-lines", invoice?.id],
    enabled: !!invoice,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("repatriation_transfer_invoice_lines")
        .select("repatriation_id, repatriation_number, container_number, amount, currency")
        .eq("invoice_id", invoice!.id)
        .order("container_number");
      if (error) throw error;
      return (data ?? []) as Line[];
    },
  });

  useEffect(() => {
    if (lines.data) {
      setAmounts(Object.fromEntries(lines.data.map((l) => [l.repatriation_id, String(Number(l.amount))])));
    }
  }, [lines.data]);

  const rows = lines.data ?? [];
  const total = rows.reduce((s, r) => s + (Number(amounts[r.repatriation_id]) || 0), 0);
  const invalid = rows.some((r) => !(Number(amounts[r.repatriation_id]) > 0));

  const save = async () => {
    if (!invoice) return;
    setSaving(true);
    const { error } = await supabase.rpc("set_repatriation_transfer_line_amounts" as any, {
      _invoice_id: invoice.id,
      _repatriation_ids: rows.map((r) => r.repatriation_id),
      _amounts: rows.map((r) => Number(amounts[r.repatriation_id])),
      _reason: reason.trim(),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`${invoice.invoice_number} updated — USD ${total.toFixed(2)}`);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["repatriations"] });
    qc.invalidateQueries({ queryKey: ["transfer-invoice-lines"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={!!invoice} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" /> Edit transfer fees — {invoice?.invoice_number}
          </DialogTitle>
        </DialogHeader>
        {lines.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border p-3 text-sm">
              <div className="space-y-1">
                <Label htmlFor="bulk-fee">Set all to (USD)</Label>
                <div className="flex gap-2">
                  <Input id="bulk-fee" type="number" step="0.01" className="w-32" value={bulk} onChange={(e) => setBulk(e.target.value)} />
                  <Button
                    variant="outline"
                    disabled={!(Number(bulk) > 0)}
                    onClick={() => setAmounts(Object.fromEntries(rows.map((r) => [r.repatriation_id, bulk])))}
                  >
                    Apply
                  </Button>
                </div>
              </div>
              <div className="text-right">
                <div>{rows.length} container{rows.length === 1 ? "" : "s"}</div>
                <div className="font-mono font-semibold">USD {total.toFixed(2)}</div>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repatriation</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead className="text-right">Fee (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.repatriation_id}>
                    <TableCell className="font-mono text-xs">{r.repatriation_number}</TableCell>
                    <TableCell className="font-mono text-xs">{r.container_number}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        className="ml-auto w-28 text-right font-mono"
                        value={amounts[r.repatriation_id] ?? ""}
                        onChange={(e) => setAmounts((a) => ({ ...a, [r.repatriation_id]: e.target.value }))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="space-y-1">
              <Label htmlFor="fee-reason">Reason for change *</Label>
              <Textarea id="fee-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. agreed rate of USD 250 for these units" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || invalid || !rows.length || !reason.trim()}>
            {saving ? "Saving…" : `Save USD ${total.toFixed(2)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
