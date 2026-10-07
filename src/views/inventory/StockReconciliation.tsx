import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Scale, RefreshCw, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

type Row = {
  material_id: string;
  name: string;
  unit: string | null;
  category: string | null;
  on_hand_qty: number;
  movement_balance: number;
  variance: number;
  receipts: number;
  issues: number;
  adjustments: number;
  movement_count: number;
  unit_cost: number;
  stock_value: number;
  last_movement_at: string | null;
};

export default function StockReconciliation() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [onlyVariance, setOnlyVariance] = useState(false);
  const [openMaterial, setOpenMaterial] = useState<Row | null>(null);

  const { data: rows, isLoading } = useQuery<Row[]>({
    queryKey: ["material-stock-reconciliation"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("material_stock_reconciliation")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        on_hand_qty: Number(r.on_hand_qty || 0),
        movement_balance: Number(r.movement_balance || 0),
        variance: Number(r.variance || 0),
        receipts: Number(r.receipts || 0),
        issues: Number(r.issues || 0),
        adjustments: Number(r.adjustments || 0),
        unit_cost: Number(r.unit_cost || 0),
        stock_value: Number(r.stock_value || 0),
      }));
    },
  });

  const { data: movements } = useQuery({
    queryKey: ["material-movements", openMaterial?.material_id],
    enabled: !!openMaterial,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("material_movements")
        .select("*")
        .eq("material_id", openMaterial!.material_id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const backfill = useMutation({
    mutationFn: async (materialId?: string) => {
      const { data, error } = await (supabase as any).rpc("reconcile_material_stock", {
        _material_id: materialId ?? null,
        _reason: materialId ? "Single-material reconciliation from Stock Reconciliation page" : "Full reconciliation from Stock Reconciliation page",
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["material-stock-reconciliation"] });
      qc.invalidateQueries({ queryKey: ["materials"] });
      const n = Number(res?.corrected || 0);
      toast({
        title: n ? `${n} material${n === 1 ? "" : "s"} corrected` : "Everything already balanced",
        description: n
          ? (res.rows ?? []).slice(0, 5).map((r: any) => `${r.name}: ${r.old_qty} → ${r.new_qty}`).join(" · ")
          : "On-hand quantities match the movement ledger.",
      });
    },
    onError: (e: any) => toast({ title: "Reconciliation failed", description: e.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter((r) => r.name?.toLowerCase().includes(s) || r.category?.toLowerCase().includes(s));
    }
    if (onlyVariance) list = list.filter((r) => Math.abs(r.variance) > 0.0001);
    return list;
  }, [rows, search, onlyVariance]);

  const varianceCount = (rows ?? []).filter((r) => Math.abs(r.variance) > 0.0001).length;
  const totalValue = (rows ?? []).reduce((a, r) => a + r.stock_value, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Scale className="h-6 w-6" />Stock Reconciliation</h1>
          <p className="text-muted-foreground">Compare on-hand quantities with the movement ledger and re-run the backfill.</p>
        </div>
        <Button onClick={() => backfill.mutate(undefined)} disabled={backfill.isPending}>
          <RefreshCw className={`mr-1 h-4 w-4 ${backfill.isPending ? "animate-spin" : ""}`} />Re-run backfill
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Materials tracked</p><p className="text-xl font-mono">{rows?.length ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">With variance</p><p className={`text-xl font-mono ${varianceCount ? "text-destructive" : "text-success"}`}>{varianceCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Stock value</p><p className="text-xl font-mono">{totalValue.toFixed(2)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-sm">Stock by material</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="only-var" checked={onlyVariance} onCheckedChange={setOnlyVariance} />
              <Label htmlFor="only-var" className="text-xs">Variances only</Label>
            </div>
            <Input className="w-56" placeholder="Search material…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Ledger balance</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Consumed</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Last movement</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : !filtered.length ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Nothing to show</TableCell></TableRow>
                ) : filtered.map((r) => (
                  <TableRow key={r.material_id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenMaterial(r)}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.category ?? "—"}{r.unit ? ` · ${r.unit}` : ""}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{r.on_hand_qty}</TableCell>
                    <TableCell className="text-right font-mono">{r.movement_balance}</TableCell>
                    <TableCell className={`text-right font-mono ${Math.abs(r.variance) > 0.0001 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                      {Math.abs(r.variance) > 0.0001 ? <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{r.variance}</span> : "0"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-success">{r.receipts}</TableCell>
                    <TableCell className="text-right font-mono text-destructive">{r.issues}</TableCell>
                    <TableCell className="text-right font-mono">{r.stock_value.toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.last_movement_at ? format(new Date(r.last_movement_at), "yyyy-MM-dd") : "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); backfill.mutate(r.material_id); }}>Fix</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Sheet open={!!openMaterial} onOpenChange={(o) => !o && setOpenMaterial(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader><SheetTitle>{openMaterial?.name}</SheetTitle></SheetHeader>
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div><p className="text-xs text-muted-foreground">On hand</p><p className="font-mono">{openMaterial?.on_hand_qty}</p></div>
            <div><p className="text-xs text-muted-foreground">Ledger balance</p><p className="font-mono">{openMaterial?.movement_balance}</p></div>
            <div><p className="text-xs text-muted-foreground">Movements</p><p className="font-mono">{openMaterial?.movement_count}</p></div>
          </div>
          <div className="mt-6">
            <p className="text-sm font-medium mb-2">Consumption &amp; receipt movements</p>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Source</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {!movements?.length ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No movements recorded</TableCell></TableRow>
                ) : movements.map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs">{format(new Date(m.created_at), "yyyy-MM-dd HH:mm")}</TableCell>
                    <TableCell><Badge variant="secondary">{String(m.movement_type).replace("_", " ")}</Badge></TableCell>
                    <TableCell className={`text-right font-mono ${Number(m.qty) < 0 ? "text-destructive" : "text-success"}`}>{Number(m.qty)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.reason ?? (m.conversion_id ? "Conversion job" : m.goods_receipt_id ? "Goods receipt" : "—")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
