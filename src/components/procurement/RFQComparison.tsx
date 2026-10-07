import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Award, Download, Trophy } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

interface Item { id: string; description: string; quantity: number; uom?: string | null }
interface Supplier { id: string; supplier_id: string; status: string; suppliers?: { name?: string } }
interface Quote { rfq_supplier_id: string; rfq_item_id: string; unit_price: number; lead_time_days?: number | null }

interface Props {
  items: Item[];
  suppliers: Supplier[];
  quotes: Quote[];
  disabled?: boolean;
  onAward?: (supplierId: string) => void;
}

export default function RFQComparison({ items, suppliers, quotes, disabled, onAward }: Props) {
  const [hideDeclined, setHideDeclined] = useState(true);
  const [respondedOnly, setRespondedOnly] = useState(false);

  const visibleSuppliers = useMemo(() => {
    let s = suppliers ?? [];
    if (hideDeclined) s = s.filter((x) => x.status !== "declined");
    if (respondedOnly) s = s.filter((x) => x.status === "responded");
    return s;
  }, [suppliers, hideDeclined, respondedOnly]);

  const priceMap = useMemo(() => {
    const m: Record<string, Record<string, Quote>> = {};
    quotes.forEach((q) => { (m[q.rfq_supplier_id] ??= {})[q.rfq_item_id] = q; });
    return m;
  }, [quotes]);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    visibleSuppliers.forEach((s) => {
      let sum = 0;
      items.forEach((it) => {
        const q = priceMap[s.id]?.[it.id];
        if (q) sum += Number(q.unit_price ?? 0) * Number(it.quantity ?? 0);
      });
      t[s.id] = sum;
    });
    return t;
  }, [visibleSuppliers, items, priceMap]);

  const leadMax = useMemo(() => {
    const l: Record<string, number | null> = {};
    visibleSuppliers.forEach((s) => {
      let max: number | null = null;
      items.forEach((it) => {
        const q = priceMap[s.id]?.[it.id];
        if (q?.lead_time_days != null) max = Math.max(max ?? 0, Number(q.lead_time_days));
      });
      l[s.id] = max;
    });
    return l;
  }, [visibleSuppliers, items, priceMap]);

  const bestByItem = useMemo(() => {
    const best: Record<string, { id: string; price: number } | null> = {};
    items.forEach((it) => {
      let winner: { id: string; price: number } | null = null;
      visibleSuppliers.forEach((s) => {
        const q = priceMap[s.id]?.[it.id];
        if (q && Number(q.unit_price) > 0) {
          if (!winner || Number(q.unit_price) < winner.price) winner = { id: s.id, price: Number(q.unit_price) };
        }
      });
      best[it.id] = winner;
    });
    return best;
  }, [items, visibleSuppliers, priceMap]);

  const exportCsv = () => {
    const header = ["Item", "Qty", "UoM", ...visibleSuppliers.map((s) => s.suppliers?.name ?? s.supplier_id)];
    const rows = items.map((it) => [
      it.description, String(it.quantity), it.uom ?? "",
      ...visibleSuppliers.map((s) => {
        const q = priceMap[s.id]?.[it.id];
        return q ? String(q.unit_price) : "";
      }),
    ]);
    const totalsRow = ["Total", "", "", ...visibleSuppliers.map((s) => totals[s.id]?.toFixed(2) ?? "")];
    const csv = [header, ...rows, totalsRow].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rfq-comparison-${Date.now()}.csv`;
    a.click();
  };

  if (!visibleSuppliers.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2"><Award className="h-5 w-5" />Quote comparison</span>
          <div className="flex items-center gap-4 text-sm font-normal">
            <label className="flex items-center gap-1"><Checkbox checked={hideDeclined} onCheckedChange={(v) => setHideDeclined(!!v)} />Hide declined</label>
            <label className="flex items-center gap-1"><Checkbox checked={respondedOnly} onCheckedChange={(v) => setRespondedOnly(!!v)} />Responded only</label>
            <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-4 w-4 me-1" />CSV</Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              {visibleSuppliers.map((s) => (
                <TableHead key={s.id} className="text-right min-w-[140px]">
                  <div>{s.suppliers?.name}</div>
                  <Badge variant="outline" className="mt-1 font-normal">{s.status}</Badge>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => {
              const best = bestByItem[it.id];
              return (
                <TableRow key={it.id}>
                  <TableCell>{it.description}</TableCell>
                  <TableCell className="text-right">{Number(it.quantity)} {it.uom ?? ""}</TableCell>
                  {visibleSuppliers.map((s) => {
                    const q = priceMap[s.id]?.[it.id];
                    if (!q) return <TableCell key={s.id} className="text-right text-muted-foreground">No quote</TableCell>;
                    const isBest = best?.id === s.id;
                    const diff = best ? ((Number(q.unit_price) - best.price) / best.price) * 100 : 0;
                    return (
                      <TableCell key={s.id} className={`text-right ${isBest ? "font-semibold text-green-600" : ""}`}>
                        {Number(q.unit_price).toFixed(2)}
                        {!isBest && best && diff > 0 && (
                          <span className="text-xs text-muted-foreground ms-1">+{diff.toFixed(1)}%</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
            <TableRow className="border-t-2">
              <TableCell className="font-semibold">Lead time (max)</TableCell>
              <TableCell />
              {visibleSuppliers.map((s) => (
                <TableCell key={s.id} className="text-right">{leadMax[s.id] != null ? `${leadMax[s.id]} d` : "—"}</TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell />
              {visibleSuppliers.map((s) => (
                <TableCell key={s.id} className="text-right font-semibold">{totals[s.id] ? totals[s.id].toFixed(2) : "—"}</TableCell>
              ))}
            </TableRow>
            {!disabled && onAward && (
              <TableRow>
                <TableCell />
                <TableCell />
                {visibleSuppliers.map((s) => (
                  <TableCell key={s.id} className="text-right">
                    {s.status === "responded" && (
                      <Button size="sm" onClick={() => onAward(s.supplier_id)}><Trophy className="h-4 w-4 me-1" />Award</Button>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
