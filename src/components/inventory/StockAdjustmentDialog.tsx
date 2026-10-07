import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, ArrowRight } from "lucide-react";

export type StockAdjItemType = "material" | "finished_product" | "sub_assembly";
export type StockAdjType = "count_variance" | "write_off" | "write_on" | "reclassification";
export type StockAdjReason =
  | "damage" | "loss" | "theft" | "found" | "recount" | "correction" | "transfer" | "other";

const REASON_BY_TYPE: Record<StockAdjType, StockAdjReason[]> = {
  count_variance: ["recount", "correction", "other"],
  write_off: ["damage", "loss", "theft", "other"],
  write_on: ["found", "correction", "other"],
  reclassification: ["transfer", "correction", "other"],
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itemType: StockAdjItemType;
  itemId: string;
  itemLabel: string;
  currentQty: number;
  currentUnitCost?: number;
  currency?: string;
  /** Restrict which adjustment types are offered. Defaults to all four. */
  allowedTypes?: StockAdjType[];
  onDone?: () => void;
}

export function StockAdjustmentDialog({
  open, onOpenChange, itemType, itemId, itemLabel,
  currentQty, currentUnitCost = 0, currency = "USD",
  allowedTypes, onDone,
}: Props) {
  const isSingleUnit = itemType === "finished_product";
  const types: StockAdjType[] = allowedTypes ?? (isSingleUnit
    ? ["write_off", "write_on"]
    : ["count_variance", "write_off", "write_on", "reclassification"]);

  const [adjType, setAdjType] = useState<StockAdjType>(types[0]);
  const [reasonCat, setReasonCat] = useState<StockAdjReason>(REASON_BY_TYPE[types[0]][0]);
  const [reasonText, setReasonText] = useState("");
  const [newQty, setNewQty] = useState<number>(currentQty);
  const [unitCost, setUnitCost] = useState<number>(currentUnitCost);
  const [fromDepot, setFromDepot] = useState<string>("");
  const [toDepot, setToDepot] = useState<string>("");
  const [depots, setDepots] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setAdjType(types[0]);
    setReasonCat(REASON_BY_TYPE[types[0]][0]);
    setReasonText("");
    setNewQty(currentQty);
    setUnitCost(currentUnitCost);
    setFromDepot("");
    setToDepot("");
    supabase.from("depots").select("id,name").order("name").then(({ data }) => {
      setDepots((data as any) ?? []);
    });
  }, [open, currentQty, currentUnitCost]);

  useEffect(() => {
    setReasonCat(REASON_BY_TYPE[adjType][0]);
    if (adjType === "write_off" && isSingleUnit) setNewQty(0);
    if (adjType === "write_on" && isSingleUnit) setNewQty(1);
  }, [adjType, isSingleUnit]);

  const qtyDelta = useMemo(() => Number(newQty) - Number(currentQty), [newQty, currentQty]);
  const valueDelta = useMemo(() => Math.round(qtyDelta * Number(unitCost || 0) * 100) / 100, [qtyDelta, unitCost]);
  const isReclass = adjType === "reclassification";

  const glHint = useMemo(() => {
    if (isReclass || valueDelta === 0) return "No ledger entry (quantity/location only)";
    if (adjType === "write_off") return "Dr Inventory Write-off Expense · Cr Inventory";
    if (adjType === "write_on") return "Dr Inventory · Cr Inventory Adjustment Income";
    if (valueDelta < 0) return "Dr Inventory Shrinkage Variance · Cr Inventory";
    return "Dr Inventory · Cr Inventory Shrinkage Variance";
  }, [adjType, valueDelta, isReclass]);

  const canSubmit =
    reasonText.trim().length >= 5 &&
    !busy &&
    (isReclass ? qtyDelta === 0 && !!fromDepot && !!toDepot && fromDepot !== toDepot : true);

  const submit = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("adjust_stock" as any, {
        _item_type: itemType,
        _item_id: itemId,
        _adjustment_type: adjType,
        _reason_category: reasonCat,
        _reason_text: reasonText.trim(),
        _new_qty: Number(newQty),
        _unit_cost: Number(unitCost) || null,
        _from_depot: fromDepot || null,
        _to_depot: toDepot || null,
      });
      if (error) throw error;
      toast({
        title: "Stock adjusted",
        description: `Reference: ${(data as any)?.reference ?? "posted"}`,
      });
      qc.invalidateQueries();
      onDone?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Adjustment failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjust stock — {itemLabel}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Adjustment type</Label>
            <RadioGroup
              value={adjType}
              onValueChange={(v) => setAdjType(v as StockAdjType)}
              className="grid grid-cols-2 gap-2 mt-2"
            >
              {types.map((t) => (
                <label key={t} className="flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer hover:bg-muted/40">
                  <RadioGroupItem value={t} />
                  <span className="text-sm capitalize">{t.replace(/_/g, " ")}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Reason category</Label>
              <Select value={reasonCat} onValueChange={(v) => setReasonCat(v as StockAdjReason)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASON_BY_TYPE[adjType].map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unit cost ({currency})</Label>
              <Input
                type="number" min="0" step="0.01"
                value={unitCost}
                disabled={isReclass}
                onChange={(e) => setUnitCost(Number(e.target.value))}
              />
            </div>
          </div>

          {!isSingleUnit && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Current qty</Label>
                <Input value={currentQty} readOnly disabled />
              </div>
              <div>
                <Label>New qty</Label>
                <Input
                  type="number" step="any"
                  value={newQty}
                  onChange={(e) => setNewQty(Number(e.target.value))}
                />
              </div>
            </div>
          )}

          {isReclass && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>From depot</Label>
                <Select value={fromDepot} onValueChange={setFromDepot}>
                  <SelectTrigger><SelectValue placeholder="Choose..." /></SelectTrigger>
                  <SelectContent>
                    {depots.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>To depot</Label>
                <Select value={toDepot} onValueChange={setToDepot}>
                  <SelectTrigger><SelectValue placeholder="Choose..." /></SelectTrigger>
                  <SelectContent>
                    {depots.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div>
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              rows={3}
              placeholder="Explain why (required, min 5 characters). Include ref numbers, count sheet ID, incident report, etc."
            />
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2 font-medium">
              Qty {currentQty} <ArrowRight className="h-3 w-3" /> {newQty}
              <span className={`ms-2 ${qtyDelta === 0 ? "" : qtyDelta > 0 ? "text-success" : "text-destructive"}`}>
                ({qtyDelta > 0 ? "+" : ""}{qtyDelta})
              </span>
            </div>
            <div className="text-muted-foreground">
              Value impact: <span className={valueDelta === 0 ? "" : valueDelta > 0 ? "text-success" : "text-destructive"}>
                {valueDelta > 0 ? "+" : ""}{currency} {Math.abs(valueDelta).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">Ledger: {glHint}</div>
            {isReclass && qtyDelta !== 0 && (
              <div className="text-xs text-warning flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Reclassification must keep qty unchanged.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? "Posting..." : "Post adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
