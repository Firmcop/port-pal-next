import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";

type ItemType = "material" | "finished_product" | "sub_assembly";
type AdjType = "count_variance" | "write_off" | "write_on" | "reclassification";
type Reason = "damage" | "loss" | "theft" | "found" | "recount" | "correction" | "transfer" | "other";

const ITEM_TYPES: ItemType[] = ["material", "finished_product", "sub_assembly"];
const ADJ_TYPES: AdjType[] = ["count_variance", "write_off", "write_on", "reclassification"];
const REASONS: Reason[] = ["damage", "loss", "theft", "found", "recount", "correction", "transfer", "other"];

const HEADERS = [
  "item_type",
  "item_name",
  "adjustment_type",
  "reason_category",
  "reason_text",
  "new_qty",
  "unit_cost",
  "from_depot",
  "to_depot",
];

type RawRow = Record<string, any>;

type ResolvedRow = {
  rowNumber: number;
  raw: RawRow;
  errors: string[];
  item_type?: ItemType;
  item_id?: string;
  item_label?: string;
  adjustment_type?: AdjType;
  reason_category?: Reason;
  reason_text?: string;
  new_qty?: number;
  qty_before?: number;
  qty_delta?: number;
  unit_cost?: number | null;
  value_delta?: number;
  from_depot?: string | null;
  to_depot?: string | null;
  from_depot_name?: string | null;
  to_depot_name?: string | null;
};

export function BulkStockAdjustmentDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone?: () => void;
}) {
  const { organizationId } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [rows, setRows] = useState<ResolvedRow[]>([]);
  const [committed, setCommitted] = useState<{ count: number; refs: string[] } | null>(null);

  const valid = useMemo(() => rows.filter((r) => r.errors.length === 0), [rows]);
  const invalid = useMemo(() => rows.filter((r) => r.errors.length > 0), [rows]);

  const reset = () => {
    setRows([]);
    setCommitted(null);
  };

  const downloadTemplate = () => {
    const example = [
      {
        item_type: "material",
        item_name: "Steel Sheet 2mm",
        adjustment_type: "count_variance",
        reason_category: "recount",
        reason_text: "Q3 stock count variance — sheet #42",
        new_qty: 120,
        unit_cost: "",
        from_depot: "",
        to_depot: "",
      },
      {
        item_type: "finished_product",
        item_name: "FP-2026-0001",
        adjustment_type: "write_off",
        reason_category: "damage",
        reason_text: "Damaged in yard incident, report #IR-2026-14",
        new_qty: 0,
        unit_cost: "",
        from_depot: "",
        to_depot: "",
      },
    ];
    const ws = XLSX.utils.json_to_sheet(example, { header: HEADERS });
    ws["!cols"] = HEADERS.map((h) => ({ wch: Math.max(14, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Adjustments");

    const meta = [
      ["Field", "Allowed values / Notes"],
      ["item_type", ITEM_TYPES.join(" | ")],
      ["item_name", "Material name, finished-product number, or sub-assembly name (must match exactly, case-insensitive)"],
      ["adjustment_type", ADJ_TYPES.join(" | ")],
      ["reason_category", REASONS.join(" | ")],
      ["reason_text", "Required, min 5 characters — include ref numbers, incident IDs, etc."],
      ["new_qty", "Target qty after adjustment. For write_off of finished_product use 0."],
      ["unit_cost", "Optional. Leave blank to use item's stored unit cost."],
      ["from_depot", "Depot name — only for reclassification"],
      ["to_depot", "Depot name — only for reclassification"],
    ];
    const metaWs = XLSX.utils.aoa_to_sheet(meta);
    XLSX.utils.book_append_sheet(wb, metaWs, "_meta");
    XLSX.writeFile(wb, "stock-adjustments-template.xlsx");
  };

  const onFile = async (file: File) => {
    if (!organizationId) {
      toast({ title: "No organization", variant: "destructive" });
      return;
    }
    reset();
    setParsing(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: RawRow[] = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
      if (!json.length) {
        toast({ title: "Empty file", variant: "destructive" });
        return;
      }
      // Pre-fetch lookup tables
      const [mats, fps, subs, depots] = await Promise.all([
        supabase.from("materials").select("id,name,unit_cost").eq("is_active", true),
        supabase.from("finished_products").select("id,product_number,total_cost,status"),
        supabase.from("sub_assembly_stock").select("id,name,avg_unit_cost,on_hand_qty"),
        supabase.from("depots").select("id,name"),
      ]);
      const matStock = await supabase.from("material_stock").select("material_id,qty_available");
      const matStockMap = new Map<string, number>();
      (matStock.data ?? []).forEach((s: any) => matStockMap.set(s.material_id, Number(s.qty_available ?? 0)));

      const norm = (s: any) => String(s ?? "").trim().toLowerCase();
      const matByName = new Map<string, any>();
      (mats.data ?? []).forEach((m: any) => matByName.set(norm(m.name), m));
      const fpByNumber = new Map<string, any>();
      (fps.data ?? []).forEach((f: any) => fpByNumber.set(norm(f.product_number), f));
      const subByName = new Map<string, any>();
      (subs.data ?? []).forEach((s: any) => subByName.set(norm(s.name), s));
      const depotByName = new Map<string, any>();
      (depots.data ?? []).forEach((d: any) => depotByName.set(norm(d.name), d));

      const parsed: ResolvedRow[] = json.map((raw, idx) => {
        const row: ResolvedRow = { rowNumber: idx + 2, raw, errors: [] };
        const itemType = norm(raw.item_type) as ItemType;
        if (!ITEM_TYPES.includes(itemType)) {
          row.errors.push(`item_type must be one of ${ITEM_TYPES.join(", ")}`);
        } else {
          row.item_type = itemType;
        }
        const adjType = norm(raw.adjustment_type) as AdjType;
        if (!ADJ_TYPES.includes(adjType)) {
          row.errors.push(`adjustment_type must be one of ${ADJ_TYPES.join(", ")}`);
        } else {
          row.adjustment_type = adjType;
        }
        const reason = norm(raw.reason_category) as Reason;
        if (!REASONS.includes(reason)) {
          row.errors.push(`reason_category must be one of ${REASONS.join(", ")}`);
        } else {
          row.reason_category = reason;
        }
        const reasonText = String(raw.reason_text ?? "").trim();
        if (reasonText.length < 5) row.errors.push("reason_text required (min 5 chars)");
        row.reason_text = reasonText;

        const newQtyRaw = raw.new_qty;
        const newQty = Number(String(newQtyRaw ?? "").replace(/,/g, ""));
        if (!Number.isFinite(newQty)) row.errors.push("new_qty must be a number");
        row.new_qty = newQty;

        const unitCostRaw = raw.unit_cost;
        if (unitCostRaw !== null && unitCostRaw !== "" && unitCostRaw !== undefined) {
          const uc = Number(String(unitCostRaw).replace(/,/g, ""));
          if (!Number.isFinite(uc)) row.errors.push("unit_cost must be a number or blank");
          else row.unit_cost = uc;
        } else {
          row.unit_cost = null;
        }

        // Resolve item
        const nameKey = norm(raw.item_name);
        if (!nameKey) row.errors.push("item_name is required");
        else if (row.item_type === "material") {
          const m = matByName.get(nameKey);
          if (!m) row.errors.push(`material not found: ${raw.item_name}`);
          else {
            row.item_id = m.id;
            row.item_label = m.name;
            row.qty_before = matStockMap.get(m.id) ?? 0;
            if (row.unit_cost === null) row.unit_cost = Number(m.unit_cost ?? 0);
          }
        } else if (row.item_type === "finished_product") {
          const f = fpByNumber.get(nameKey);
          if (!f) row.errors.push(`finished_product not found (use product_number): ${raw.item_name}`);
          else {
            row.item_id = f.id;
            row.item_label = f.product_number;
            row.qty_before = f.status === "in_stock" ? 1 : 0;
            if (row.unit_cost === null) row.unit_cost = Number(f.total_cost ?? 0);
          }
        } else if (row.item_type === "sub_assembly") {
          const s = subByName.get(nameKey);
          if (!s) row.errors.push(`sub_assembly not found: ${raw.item_name}`);
          else {
            row.item_id = s.id;
            row.item_label = s.name;
            row.qty_before = Number(s.on_hand_qty ?? 0);
            if (row.unit_cost === null) row.unit_cost = Number(s.avg_unit_cost ?? 0);
          }
        }

        // Depots for reclassification
        if (row.adjustment_type === "reclassification") {
          const fromKey = norm(raw.from_depot);
          const toKey = norm(raw.to_depot);
          if (!fromKey || !toKey) row.errors.push("from_depot and to_depot required for reclassification");
          else if (fromKey === toKey) row.errors.push("from_depot and to_depot must differ");
          else {
            const f = depotByName.get(fromKey);
            const t = depotByName.get(toKey);
            if (!f) row.errors.push(`from_depot not found: ${raw.from_depot}`);
            if (!t) row.errors.push(`to_depot not found: ${raw.to_depot}`);
            row.from_depot = f?.id ?? null;
            row.to_depot = t?.id ?? null;
            row.from_depot_name = f?.name ?? String(raw.from_depot ?? "");
            row.to_depot_name = t?.name ?? String(raw.to_depot ?? "");
          }
          if (row.qty_before !== undefined && row.new_qty !== undefined && Number(row.qty_before) !== Number(row.new_qty)) {
            row.errors.push("reclassification requires new_qty == current qty");
          }
        }

        if (row.qty_before !== undefined && row.new_qty !== undefined) {
          row.qty_delta = Number(row.new_qty) - Number(row.qty_before);
          row.value_delta = Math.round(Number(row.qty_delta) * Number(row.unit_cost ?? 0) * 100) / 100;
        }
        return row;
      });

      setRows(parsed);
    } catch (e: any) {
      toast({ title: "Parse error", description: e.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const commit = async () => {
    if (!valid.length) return;
    setCommitting(true);
    try {
      const items = valid.map((r) => ({
        item_type: r.item_type,
        item_id: r.item_id,
        adjustment_type: r.adjustment_type,
        reason_category: r.reason_category,
        reason_text: r.reason_text,
        new_qty: r.new_qty,
        unit_cost: r.unit_cost ?? "",
        from_depot: r.from_depot ?? "",
        to_depot: r.to_depot ?? "",
      }));
      const { data, error } = await supabase.rpc("adjust_stock_batch" as any, { _items: items as any });
      if (error) throw error;
      const refs = ((data as any)?.results ?? []).map((r: any) => r.reference).filter(Boolean);
      setCommitted({ count: (data as any)?.count ?? refs.length, refs });
      toast({ title: `Posted ${refs.length} adjustments` });
      qc.invalidateQueries();
      onDone?.();
    } catch (e: any) {
      toast({ title: "Batch failed — no changes saved", description: e.message, variant: "destructive" });
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Bulk stock adjustment upload
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto py-2">
          {!rows.length && !committed && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Upload an .xlsx/.csv file. Every row is previewed with current qty and computed delta.
                The whole batch is posted atomically — if any row fails on commit, nothing is saved.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={downloadTemplate}>
                  <Download className="h-4 w-4 me-1" /> Download template
                </Button>
                <label className="inline-flex">
                  <Input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
                    disabled={parsing}
                  />
                </label>
                {parsing && <Loader2 className="h-4 w-4 animate-spin" />}
              </div>
            </div>
          )}

          {rows.length > 0 && !committed && (
            <>
              <div className="flex flex-wrap gap-3 items-center">
                <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                  <CheckCircle2 className="h-3.5 w-3.5 me-1" /> {valid.length} valid
                </Badge>
                {invalid.length > 0 && (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                    <AlertTriangle className="h-3.5 w-3.5 me-1" /> {invalid.length} with errors
                  </Badge>
                )}
                <Button variant="outline" size="sm" onClick={() => setRows([])}>Upload another file</Button>
              </div>

              <div className="border rounded-md overflow-auto max-h-[45vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Row</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Adj</TableHead>
                      <TableHead className="text-right">Before</TableHead>
                      <TableHead className="text-right">After</TableHead>
                      <TableHead className="text-right">Δ Qty</TableHead>
                      <TableHead className="text-right">Δ Value</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.rowNumber} className={r.errors.length ? "bg-destructive/5" : ""}>
                        <TableCell className="font-mono text-xs">{r.rowNumber}</TableCell>
                        <TableCell className="text-sm">
                          {r.item_label ?? <span className="text-muted-foreground">{String(r.raw.item_name ?? "")}</span>}
                          {r.adjustment_type === "reclassification" && (
                            <div className="text-xs text-muted-foreground">
                              {r.from_depot_name} → {r.to_depot_name}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs capitalize">{r.item_type?.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-xs capitalize">{r.adjustment_type?.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.qty_before ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.new_qty ?? "—"}</TableCell>
                        <TableCell className={`text-right font-mono text-xs ${(r.qty_delta ?? 0) > 0 ? "text-success" : (r.qty_delta ?? 0) < 0 ? "text-destructive" : ""}`}>
                          {r.qty_delta === undefined ? "—" : `${r.qty_delta > 0 ? "+" : ""}${r.qty_delta}`}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs ${(r.value_delta ?? 0) > 0 ? "text-success" : (r.value_delta ?? 0) < 0 ? "text-destructive" : ""}`}>
                          {r.value_delta === undefined ? "—" : (r.value_delta > 0 ? "+" : "") + r.value_delta.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-xs max-w-xs truncate" title={r.reason_text}>{r.reason_text}</TableCell>
                        <TableCell className="text-xs">
                          {r.errors.length ? (
                            <span className="text-destructive" title={r.errors.join("; ")}>
                              {r.errors[0]}{r.errors.length > 1 ? ` (+${r.errors.length - 1})` : ""}
                            </span>
                          ) : <span className="text-success">Ready</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {invalid.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Rows with errors are skipped. Fix them in the file and re-upload to include them.
                </div>
              )}
            </>
          )}

          {committed && (
            <div className="text-center space-y-2 py-4">
              <CheckCircle2 className="h-10 w-10 text-success mx-auto" />
              <p className="font-medium">Committed {committed.count} adjustments</p>
              <p className="text-xs text-muted-foreground break-all">
                {committed.refs.slice(0, 10).join(", ")}{committed.refs.length > 10 ? "…" : ""}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {rows.length > 0 && !committed && (
            <Button onClick={commit} disabled={!valid.length || committing}>
              {committing ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Upload className="h-4 w-4 me-1" />}
              Commit {valid.length} adjustment{valid.length === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
