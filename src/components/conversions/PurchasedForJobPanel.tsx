import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Money } from "@/components/Money";
import { ShoppingCart } from "lucide-react";

/**
 * Shows purchase-order lines that were received against this job (or its
 * project) but have not yet been pushed onto the job's material costs.
 * Allocating a line copies it into conversion_materials and issues the stock.
 */
export function PurchasedForJobPanel({
  conversionId,
  projectId,
  onAllocated,
}: {
  conversionId: string;
  projectId?: string | null;
  onAllocated: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["job-purchased-lines", conversionId, projectId],
    queryFn: async () => {
      let poq = supabase.from("purchase_orders").select("id, po_number, conversion_id, project_id");
      const { data: pos, error: poErr } = await poq;
      if (poErr) throw poErr;
      const relevant = (pos ?? []).filter(
        (p: any) => p.conversion_id === conversionId || (projectId && p.project_id === projectId),
      );
      if (!relevant.length) return [];
      const poIds = relevant.map((p: any) => p.id);

      const { data: receipts, error: rErr } = await supabase
        .from("goods_receipts")
        .select("id, po_id, received_at")
        .in("po_id", poIds);
      if (rErr) throw rErr;
      if (!receipts?.length) return [];

      const { data: items, error: iErr } = await (supabase as any)
        .from("goods_receipt_items")
        .select("id, receipt_id, po_item_id, received_qty, allocated_conversion_material_id, po_items:po_item_id(description, unit_price)")
        .in("receipt_id", receipts.map((r: any) => r.id));
      if (iErr) throw iErr;

      const poById = new Map(relevant.map((p: any) => [p.id, p]));
      const recById = new Map((receipts ?? []).map((r: any) => [r.id, r]));

      return (items ?? [])
        .filter((it: any) => !it.allocated_conversion_material_id && Number(it.received_qty) > 0)
        .map((it: any) => {
          const rec = recById.get(it.receipt_id);
          const po = rec ? poById.get(rec.po_id) : null;
          return {
            ...it,
            po_number: po?.po_number ?? "—",
            direct: po?.conversion_id === conversionId,
          };
        });
    },
  });

  const allocate = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.rpc("allocate_receipt_line_to_conversion" as any, {
        _receipt_item_id: itemId,
        _conversion_id: conversionId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Allocated to job", description: "Cost added and stock issued." });
      qc.invalidateQueries({ queryKey: ["job-purchased-lines"] });
      onAllocated();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["conversion-purchase-orders", conversionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conversion_purchase_orders", { _conversion_id: conversionId });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!conversionId,
  });

  if (isLoading && !orders.length) return null;
  if (!lines.length && !orders.length) return null;

  return (
    <div className="rounded-md border p-3 space-y-3">
      {!!orders.length && (
        <div className="space-y-1">
          <p className="text-sm font-medium flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />Purchase orders for this job and its project
          </p>
          <ul className="space-y-1">
            {orders.map((o: any) => (
              <li key={o.po_id} className="flex flex-wrap items-center gap-2 border-t pt-1 text-sm">
                <span className="font-mono text-xs">{o.po_number}</span>
                <span className="flex-1 min-w-[10rem]">{o.supplier_name ?? "—"}</span>
                <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                {o.via_project && <Badge variant="secondary" className="text-[10px]">via project</Badge>}
                <span className="text-xs text-muted-foreground">
                  received {Number(o.received_qty ?? 0)} / {Number(o.ordered_qty ?? 0)}
                </span>
                <span className="font-mono text-sm">
                  {o.currency} <Money amount={Number(o.total_cost ?? 0)} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!lines.length && (
      <>
      <p className="text-sm font-medium flex items-center gap-2">
        <ShoppingCart className="h-4 w-4" />Purchased for this job — not yet costed
      </p>
      <ul className="space-y-1">
        {lines.map((l: any) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border-t pt-1">
            <span className="flex-1 min-w-[12rem]">
              {l.po_items?.description ?? "Purchased material"}
              <span className="text-muted-foreground"> · {Number(l.received_qty)} @ </span>
              <Money amount={l.po_items?.unit_price} />
            </span>
            <Badge variant="outline" className="text-xs font-mono">{l.po_number}</Badge>
            {!l.direct && <Badge variant="secondary" className="text-xs">via project</Badge>}
            <Button size="sm" variant="outline" disabled={allocate.isPending} onClick={() => allocate.mutate(l.id)}>
              Allocate
            </Button>
          </li>
        ))}
      </ul>
      </>
      )}
    </div>
  );
}
