import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Trophy, AlertTriangle } from "lucide-react";

interface Item { id: string; description: string; material_id: string | null; quantity: number; uom?: string | null }
interface Quote { rfq_item_id: string; unit_price: number; lead_time_days?: number | null }

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rfqId: string;
  supplierId: string;
  supplierName: string;
  currency?: string | null;
  items: Item[];
  quotes: Quote[];
  onSuccess: (poId: string) => void;
}

type LineDraft = {
  rfq_item_id: string;
  material_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  lead_time_days?: number | null;
};

export default function AwardReviewDialog({ open, onOpenChange, rfqId, supplierId, supplierName, currency, items, quotes, onSuccess }: Props) {
  const { toast } = useToast();
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [freight, setFreight] = useState(0);
  const [other, setOther] = useState(0);
  const [pricesIncludeTax, setPricesIncludeTax] = useState(false);

  useEffect(() => {
    if (!open) return;
    const qMap: Record<string, Quote> = {};
    quotes.forEach((q) => { qMap[q.rfq_item_id] = q; });
    setLines(items.map((it) => {
      const q = qMap[it.id];
      return {
        rfq_item_id: it.id,
        material_id: it.material_id,
        description: it.description,
        quantity: Number(it.quantity),
        unit_price: q ? Number(q.unit_price) : 0,
        tax_rate: 0,
        lead_time_days: q?.lead_time_days ?? null,
      };
    }));
    setFreight(0); setOther(0); setPricesIncludeTax(false);
  }, [open, items, quotes]);

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (!lines.length) errs.push("At least one line required.");
    lines.forEach((l, i) => {
      if (l.quantity <= 0) errs.push(`Line ${i + 1}: quantity must be > 0.`);
      if (l.unit_price < 0) errs.push(`Line ${i + 1}: unit price cannot be negative.`);
      if (l.unit_price === 0) errs.push(`Line ${i + 1}: unit price is zero — verify with supplier.`);
    });
    return errs;
  }, [lines]);

  const totals = useMemo(() => {
    let subtotal = 0, tax = 0;
    lines.forEach((l) => {
      const lineNet = l.quantity * l.unit_price;
      if (pricesIncludeTax) {
        const net = lineNet / (1 + l.tax_rate / 100);
        subtotal += net;
        tax += lineNet - net;
      } else {
        subtotal += lineNet;
        tax += lineNet * (l.tax_rate / 100);
      }
    });
    const grand = subtotal + tax + Number(freight || 0) + Number(other || 0);
    return { subtotal, tax, grand };
  }, [lines, freight, other, pricesIncludeTax]);

  const awardMut = useMutation({
    mutationFn: async () => {
      const overrides = {
        lines: lines.map((l) => ({
          material_id: l.material_id,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          tax_rate: l.tax_rate,
          is_vatable: l.tax_rate > 0,
        })),
        freight_amount: Number(freight || 0),
        other_charges_amount: Number(other || 0),
        prices_include_tax: pricesIncludeTax,
      };
      const { data, error } = await supabase.rpc("award_rfq", {
        _rfq_id: rfqId, _supplier_id: supplierId, _overrides: overrides as any,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (poId) => {
      toast({ title: "Awarded", description: "Draft PO created." });
      onOpenChange(false);
      onSuccess(poId);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const blocking = errors.some((e) => e.includes("required") || e.includes("must be") || e.includes("cannot be"));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Trophy className="h-5 w-5" />Review award to {supplierName}</DialogTitle>
          <DialogDescription>
            Adjust quantities, unit prices, taxes, and additional charges before the draft PO is generated. Currency: {currency ?? "org default"}.
          </DialogDescription>
        </DialogHeader>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="w-20 text-right">Qty</TableHead>
              <TableHead className="w-32">Unit price</TableHead>
              <TableHead className="w-24">Tax %</TableHead>
              <TableHead className="w-24">Lead (d)</TableHead>
              <TableHead className="w-28 text-right">Line total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, idx) => {
              const lineTotal = l.quantity * l.unit_price;
              return (
                <TableRow key={l.rfq_item_id}>
                  <TableCell>
                    <Input value={l.description} onChange={(e) =>
                      setLines((xs) => xs.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" min={0} step="0.01" value={l.quantity} onChange={(e) =>
                      setLines((xs) => xs.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x))} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" min={0} step="0.01" value={l.unit_price} onChange={(e) =>
                      setLines((xs) => xs.map((x, i) => i === idx ? { ...x, unit_price: Number(e.target.value) } : x))} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" min={0} step="0.01" value={l.tax_rate} onChange={(e) =>
                      setLines((xs) => xs.map((x, i) => i === idx ? { ...x, tax_rate: Number(e.target.value) } : x))} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{l.lead_time_days ?? "—"}</TableCell>
                  <TableCell className="text-right">{lineTotal.toFixed(2)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="grid grid-cols-2 gap-4 mt-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-md bg-muted/40">
              <div>
                <Label>Prices include tax</Label>
                <p className="text-xs text-muted-foreground">Toggle if unit prices already contain VAT.</p>
              </div>
              <Switch checked={pricesIncludeTax} onCheckedChange={setPricesIncludeTax} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Freight</Label>
                <Input type="number" min={0} step="0.01" value={freight} onChange={(e) => setFreight(Number(e.target.value))} /></div>
              <div><Label className="text-xs">Other charges</Label>
                <Input type="number" min={0} step="0.01" value={other} onChange={(e) => setOther(Number(e.target.value))} /></div>
            </div>
          </div>
          <div className="p-3 rounded-md border space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{totals.subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>Tax</span><span>{totals.tax.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>Freight</span><span>{Number(freight || 0).toFixed(2)}</span></div>
            <div className="flex justify-between"><span>Other charges</span><span>{Number(other || 0).toFixed(2)}</span></div>
            <div className="flex justify-between border-t pt-1 font-semibold"><span>Grand total</span><span>{totals.grand.toFixed(2)}</span></div>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-100 space-y-1">
            <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Please review</div>
            <ul className="list-disc list-inside">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => awardMut.mutate()} disabled={awardMut.isPending || blocking}>
            <Trophy className="h-4 w-4 me-1" />{awardMut.isPending ? "Creating…" : "Generate draft PO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
