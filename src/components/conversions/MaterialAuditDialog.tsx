/**
 * Per-material audit trail + procurement status badges for a conversion job.
 *  - useMaterialProcurementStatus  requisition / PO progress per material (realtime)
 *  - ProcurementStatusBadge        badge with deep link to the requisition or PO
 *  - MaterialAuditDialog           who issued/returned/changed what, with before → after
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History } from "lucide-react";
import { format } from "date-fns";

export type ProcurementStatusRow = {
  material_id: string;
  request_id: string | null;
  request_status: string | null;
  urgency: string | null;
  requested_qty: number | null;
  needed_by: string | null;
  purchase_order_id: string | null;
  po_number: string | null;
  po_status: string | null;
  ordered_qty: number | null;
  received_qty: number | null;
};

/** Requisition + PO progress per material, kept live via realtime. */
export function useMaterialProcurementStatus(conversionId?: string | null) {
  const qc = useQueryClient();
  const key = ["conversion-material-procurement", conversionId];

  const query = useQuery({
    queryKey: key,
    enabled: !!conversionId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("conversion_material_procurement_status", {
        _conversion_id: conversionId,
      });
      if (error) throw error;
      return (data ?? []) as ProcurementStatusRow[];
    },
  });

  useEffect(() => {
    if (!conversionId) return;
    const invalidate = () => qc.invalidateQueries({ queryKey: key });
    const ch = supabase
      .channel(`cm-procurement-${conversionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "material_requests" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_orders" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "po_items" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "goods_receipts" }, invalidate)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversionId]);

  return query;
}

export function useProcurementStatusMap(conversionId?: string | null) {
  const { data = [] } = useMaterialProcurementStatus(conversionId);
  return useMemo(() => new Map(data.map((r) => [r.material_id, r])), [data]);
}

/** Small badge summarising where a shortfall has reached in procurement. */
export function ProcurementStatusBadge({ row }: { row?: ProcurementStatusRow | null }) {
  if (!row) return <span className="text-xs text-muted-foreground">—</span>;

  if (row.purchase_order_id) {
    const ordered = Number(row.ordered_qty ?? 0);
    const received = Number(row.received_qty ?? 0);
    const label =
      received > 0 && ordered > 0 && received >= ordered
        ? "PO received"
        : received > 0
          ? `PO part-received ${received}/${ordered}`
          : `PO ${row.po_status ?? "raised"}`;
    const tone = received >= ordered && ordered > 0 ? "border-emerald-500 text-emerald-600" : "border-sky-500 text-sky-600";
    return (
      <Link to={`/procurement?po=${row.purchase_order_id}`}>
        <Badge variant="outline" className={`text-[10px] ${tone}`}>{row.po_number ?? label} · {label}</Badge>
      </Link>
    );
  }

  const status = (row.request_status ?? "pending").toLowerCase();
  const tone =
    status === "approved" ? "border-emerald-500 text-emerald-600"
      : status === "rejected" ? "border-red-500 text-red-600"
        : "border-amber-500 text-amber-600";
  const text =
    status === "approved" ? "Requisition approved"
      : status === "rejected" ? "Requisition rejected"
        : "Requisition pending";
  return (
    <Badge variant="outline" className={`text-[10px] ${tone}`}>
      {text}{row.requested_qty ? ` · ${Number(row.requested_qty)}` : ""}
    </Badge>
  );
}

const EVENT_LABEL: Record<string, string> = {
  issue: "Issued",
  return: "Returned",
  line_created: "Line added",
  line_deleted: "Line removed",
  planned_qty_changed: "Planned qty changed",
  used_qty_changed: "Used qty changed",
  unit_cost_changed: "Unit cost changed",
};

/** Read-only history of everything that happened to a material line on this job. */
export function MaterialAuditDialog({
  conversionId, materialId, conversionMaterialId, label,
}: {
  conversionId: string;
  materialId?: string | null;
  conversionMaterialId?: string | null;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: ["conversion-material-audit", conversionId, materialId, conversionMaterialId],
    enabled: open,
    queryFn: async () => {
      let q = (supabase as any)
        .from("conversion_material_audit")
        .select("*")
        .eq("conversion_id", conversionId)
        .order("created_at", { ascending: false })
        .limit(200);
      q = materialId ? q.eq("material_id", materialId) : q.eq("conversion_material_id", conversionMaterialId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const actorIds = useMemo(
    () => Array.from(new Set(rows.map((r: any) => r.created_by).filter(Boolean))),
    [rows],
  );

  const { data: actors = {} } = useQuery({
    queryKey: ["audit-actors", actorIds],
    enabled: open && actorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, display_name").in("user_id", actorIds as string[]);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((p: any) => [p.user_id, p.display_name])) as Record<string, string>;
    },
  });

  return (
    <>
      <Button size="sm" variant="ghost" title="History" onClick={() => setOpen(true)}>
        <History className="h-3 w-3" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>History — {label}</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Before → After</TableHead>
                  <TableHead>Reason / note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!rows.length ? (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No history yet</TableCell></TableRow>
                ) : rows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">{format(new Date(r.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                    <TableCell className="text-xs">{(actors as any)[r.created_by] ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-[10px]">{EVENT_LABEL[r.event] ?? r.event}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.qty != null ? Number(r.qty) : "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.field_changed ? `${r.old_value ?? "—"} → ${r.new_value ?? "—"}` : (r.unit_cost != null ? `@ ${Number(r.unit_cost).toLocaleString()}` : "—")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[r.reason, r.note].filter(Boolean).join(" — ") || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
