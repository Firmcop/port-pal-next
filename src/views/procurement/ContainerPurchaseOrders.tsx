import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useSearchParams } from "@/lib/router";
import { formatMoneyCode } from "@/lib/money";
import { getDefaultCurrency } from "@/lib/finance-format";
import { getPrintDepot, getWorkingDepotId } from "@/lib/app-settings";
import { printPurchaseOrder } from "@/lib/document-templates";
import {
  CONTAINER_GRADES, CONTAINER_SIZES, CONTAINER_TYPES, checkReceiveUnits, describeContainerLine,
  normalizeContainerNumber, poProgress, rowsForOutstanding, type ReceiveUnit, type UnitIssue,
} from "@/lib/container-po";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApprovalTimeline } from "@/components/approvals/ApprovalTimeline";
import PoStatusCell from "@/components/procurement/PoStatusCell";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Plus, Trash2, Pencil, Eye, Printer, PackageCheck, FileText, Ban, Container, Truck } from "lucide-react";

const sb = supabase as any;
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d?: string | null) => (d ? format(new Date(d), "dd MMM yyyy") : "—");

interface Line {
  container_size: string;
  /** HC or LC for dry containers; blank for other types */
  container_height: "" | "HC" | "LC";
  container_category: string;
  container_grade: string;
  quantity: string;
  unit_price: string;
}
const emptyLine = (): Line => ({ container_size: "40", container_height: "HC", container_category: "dry", container_grade: "B", quantity: "1", unit_price: "" });

export default function ContainerPurchaseOrdersTab() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();

  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const [billId, setBillId] = useState<string | null>(null);
  const [closeId, setCloseId] = useState<string | null>(null);

  const { data: orders, isLoading } = useQuery({
    queryKey: ["container-pos"],
    queryFn: async () => {
      const [{ data: pos, error }, { data: sums, error: e2 }] = await Promise.all([
        sb.from("purchase_orders")
          .select("*, suppliers(name, contact_person, phone, email, address, currency), projects:project_id(code, name), po_items(*)")
          .eq("po_type", "containers").order("created_at", { ascending: false }),
        sb.from("v_container_po_summary").select("*"),
      ]);
      if (error) throw error;
      if (e2) throw e2;
      const byId = new Map((sums ?? []).map((s: any) => [s.po_id, s]));
      return (pos ?? []).map((p: any) => ({ ...p, summary: byId.get(p.id) ?? null }));
    },
  });

  useEffect(() => {
    const open = searchParams.get("open");
    if (open && orders?.some((o: any) => o.id === open)) setViewId(open);
  }, [searchParams, orders]);

  const totals = useMemo(() => {
    const t = { open: 0, unitsToCome: 0, paidNotReceived: new Map<string, number>(), receivedNotBilled: new Map<string, number>() };
    for (const o of orders ?? []) {
      if (!o.summary || ["cancelled", "draft"].includes(o.status)) continue;
      const p = poProgress(o.summary);
      const cur = o.currency ?? getDefaultCurrency();
      if (p.unitsToCome > 0) { t.open++; t.unitsToCome += p.unitsToCome; }
      if (p.paidNotReceived > 0) t.paidNotReceived.set(cur, (t.paidNotReceived.get(cur) ?? 0) + p.paidNotReceived);
      if (p.receivedNotBilled > 0) t.receivedNotBilled.set(cur, (t.receivedNotBilled.get(cur) ?? 0) + p.receivedNotBilled);
    }
    return t;
  }, [orders]);
  const moneyList = (m: Map<string, number>) =>
    m.size ? [...m.entries()].map(([c, v]) => formatMoneyCode(v, c)).join(" · ") : "—";

  const handlePrint = (po: any) => {
    const depot = getPrintDepot();
    printPurchaseOrder({
      po_number: po.po_number,
      status: po.status,
      created_at: po.created_at,
      total_cost: Number(po.total_cost) || 0,
      currency: po.currency ?? po.suppliers?.currency ?? getDefaultCurrency(),
      notes: [po.pickup_location && `Pick up from: ${po.pickup_location}`, po.expected_delivery && `Expected: ${fmtDate(po.expected_delivery)}`]
        .filter(Boolean).join("\n") || null,
      conversion_number: null,
      supplier: po.suppliers ?? null,
      line_items: (po.po_items ?? []).map((it: any) => ({
        description: it.description ?? "", quantity: Number(it.quantity) || 0,
        unit_price: Number(it.unit_price) || 0, total_cost: Number(it.total_cost) || 0,
      })),
      depot: depot ? { name: depot.name, code: depot.code, location: depot.location, logo_url: depot.logo_url } : null,
      issuer_name: null,
    } as any);
  };

  const refresh = () => {
    ["container-pos", "purchase-orders", "containers", "goods-receipts-all", "supplier-invoices", "container-record-status"]
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Orders awaiting containers" value={String(totals.open)} />
        <Stat label="Containers still to come" value={String(totals.unitsToCome)} />
        <Stat label="Paid, not yet received" value={moneyList(totals.paidNotReceived)} hint="Money with suppliers for containers not delivered yet" />
        <Stat label="Received, no supplier invoice" value={moneyList(totals.receivedNotBilled)} hint="Ask the supplier for their invoice" />
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">
          Containers bought from suppliers who do not store them with us. Containers stored here for an owner are billed when used, as before.
        </p>
        <Button size="sm" onClick={() => setEditing({ id: null })}><Plus className="mr-1 h-4 w-4" />New container PO</Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Containers</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Supplier invoice</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !orders?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No container purchase orders yet</TableCell></TableRow>
              ) : orders.map((po: any) => {
                const s = po.summary;
                const cur = po.currency ?? po.suppliers?.currency ?? getDefaultCurrency();
                const canReceive = ["confirmed", "partially_received"].includes(po.status)
                  && !["pending", "rejected"].includes(po.approval_status ?? "");
                return (
                  <TableRow key={po.id}>
                    <TableCell className="font-mono text-xs">{po.po_number}</TableCell>
                    <TableCell className="font-medium">
                      {po.suppliers?.name ?? "—"}
                      {po.expected_delivery && <div className="text-xs text-muted-foreground">Expected {fmtDate(po.expected_delivery)}</div>}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="font-mono">{s?.units_received ?? 0}/{s?.units_ordered ?? 0}</span> received
                      <div className="text-xs text-muted-foreground truncate max-w-[220px]">
                        {(po.po_items ?? []).map((i: any) => `${Number(i.quantity)}× ${i.container_size ?? ""}${i.container_height === "HC" ? "HC" : ""}`).join(", ")}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatMoneyCode(po.total_cost, cur)}</TableCell>
                    <TableCell className="text-xs">
                      {s?.bill_supplier_ref ? <span className="font-mono">{s.bill_supplier_ref}</span> : <span className="text-muted-foreground">not received</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatMoneyCode(s?.paid ?? 0, cur)}
                      {Number(s?.paid_pending_approval ?? 0) > 0 && (
                        <div className="text-[10px] text-warning">+{formatMoneyCode(s.paid_pending_approval, cur)} awaiting approval</div>
                      )}
                    </TableCell>
                    <TableCell><PoStatusCell poId={po.id} status={po.status} allowPrepay /></TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" title="View" onClick={() => setViewId(po.id)}><Eye className="h-3 w-3" /></Button>
                        <Button size="sm" variant="ghost" title="Print" onClick={() => handlePrint(po)}><Printer className="h-3 w-3" /></Button>
                        {["draft", "sent"].includes(po.status) && (
                          <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditing({ id: po.id })}><Pencil className="h-3 w-3" /></Button>
                        )}
                        {!["draft", "cancelled"].includes(po.status) && (
                          <Button size="sm" variant="ghost" title="Record supplier invoice" onClick={() => setBillId(po.id)}><FileText className="h-3 w-3" /></Button>
                        )}
                        {canReceive && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setReceiveId(po.id)}><PackageCheck className="mr-1 h-3 w-3" />Receive</Button>
                            <Button size="sm" variant="ghost" title="Close short" onClick={() => setCloseId(po.id)}><Ban className="h-3 w-3" /></Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && <EditDialog poId={editing.id} existing={orders?.find((o: any) => o.id === editing.id)} onClose={() => setEditing(null)} onSaved={refresh} />}
      {receiveId && <ReceiveDialog po={orders?.find((o: any) => o.id === receiveId)} onClose={() => setReceiveId(null)} onSaved={refresh} />}
      {billId && <BillDialog po={orders?.find((o: any) => o.id === billId)} onClose={() => setBillId(null)} onSaved={refresh} />}
      {closeId && <CloseShortDialog po={orders?.find((o: any) => o.id === closeId)} onClose={() => setCloseId(null)} onSaved={refresh} />}
      {viewId && <ViewDialog po={orders?.find((o: any) => o.id === viewId)} onClose={() => setViewId(null)} />}
    </>
  );

}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card><CardContent className="p-3" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold font-mono truncate">{value}</div>
    </CardContent></Card>
  );
}

// ---------------------------------------------------------------- create / edit
function EditDialog({ poId, existing, onClose, onSaved }: { poId: string | null; existing?: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [supplierId, setSupplierId] = useState<string>(existing?.supplier_id ?? "");
  const [pickup, setPickup] = useState<string>(existing?.pickup_location ?? "");
  const [expected, setExpected] = useState<string>(existing?.expected_delivery ?? "");
  const [projectId, setProjectId] = useState<string>(existing?.project_id ?? "");
  const [lines, setLines] = useState<Line[]>(
    existing?.po_items?.length
      ? existing.po_items.map((i: any) => ({
          container_size: i.container_size ?? "40",
          container_height: (i.container_category ?? "dry") !== "dry" ? "" : i.container_height === "HC" ? "HC" : "LC",
          container_category: i.container_category ?? "dry", container_grade: i.container_grade ?? "B",
          quantity: String(Number(i.quantity) || 1), unit_price: String(i.unit_price ?? ""),
        }))
      : [emptyLine()],
  );
  const [error, setError] = useState<string | null>(null);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-list"],
    queryFn: async () => (await sb.from("suppliers").select("id, name, currency").eq("is_active", true).order("name")).data ?? [],
  });
  const { data: projects } = useQuery({
    queryKey: ["projects-active-po"],
    queryFn: async () => (await sb.from("projects").select("id, code, name").order("created_at", { ascending: false })).data ?? [],
  });
  const supplier = (suppliers ?? []).find((s: any) => s.id === supplierId);
  const currency = existing?.currency ?? supplier?.currency ?? getDefaultCurrency();
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);

  const set = (i: number, k: keyof Line, v: string) => setLines((p) => p.map((l, idx) => {
    if (idx !== i) return l;
    const next = { ...l, [k]: v } as Line;
    if (k === "container_category") next.container_height = v === "dry" ? (l.container_height || "HC") : "";
    return next;
  }));

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!supplierId) throw new Error("Pick the supplier");
      if (!lines.length) throw new Error("Add at least one line");
      lines.forEach((l, i) => {
        if (!(Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0)) throw new Error(`Line ${i + 1}: enter how many containers`);
        if (!(Number(l.unit_price) > 0)) throw new Error(`Line ${i + 1}: enter the price per container`);
        if (l.container_category === "dry" && !l.container_height) throw new Error(`Line ${i + 1}: pick HC or LC`);
      });
      const header = {
        supplier_id: supplierId,
        project_id: projectId || null,
        pickup_location: pickup.trim() || null,
        expected_delivery: expected || null,
        prices_include_tax: false, freight_amount: 0, other_charges_amount: 0,
      };
      let id = poId;
      if (!id) {
        const { data, error } = await sb.from("purchase_orders").insert({
          ...header, po_type: "containers", total_cost: 0, created_by: user?.id,
          po_number: `PO-CTR-${Date.now().toString(36).toUpperCase()}`,
        }).select("id").single();
        if (error) throw error;
        id = data.id;
      } else {
        const { data: cur, error: cErr } = await sb.from("purchase_orders").select("status").eq("id", id).single();
        if (cErr) throw cErr;
        if (!["draft", "sent"].includes(cur.status)) throw new Error(`The order is ${cur.status} and can no longer be edited`);
        const { error } = await sb.from("purchase_orders").update(header).eq("id", id);
        if (error) throw error;
        const { error: dErr } = await sb.from("po_items").delete().eq("po_id", id);
        if (dErr) throw dErr;
      }
      const rows = lines.map((l) => ({
        po_id: id,
        material_id: null,
        description: describeContainerLine({ ...l, container_height: l.container_height || null }),
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        total_cost: Number(l.quantity) * Number(l.unit_price),
        is_vatable: false, tax_rate: 0,
        container_size: l.container_size,
        container_height: l.container_height || null,
        container_category: l.container_category,
        container_grade: l.container_grade || null,
      }));
      const { error: iErr } = await sb.from("po_items").insert(rows);
      if (iErr) throw iErr;
    },
    onSuccess: () => {
      toast({ title: poId ? "Order updated" : "Container PO created", description: poId ? undefined : "Send it to the supplier, then mark it confirmed when they accept." });
      onSaved(); onClose();
    },
    onError: (e: any) => setError(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{poId ? `Edit ${existing?.po_number ?? "order"}` : "New container purchase order"}</DialogTitle>
          <DialogDescription>Containers bought from a supplier. They join the yard as ours when received.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Supplier *</Label>
            <Select value={supplierId || undefined} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Pick supplier" /></SelectTrigger>
              <SelectContent>{(suppliers ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}{s.currency ? ` (${s.currency})` : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Project (optional)</Label>
            <Select value={projectId || "__none__"} onValueChange={(v) => setProjectId(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None — for stock</SelectItem>
                {(projects ?? []).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Pick up from</Label>
            <Input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="e.g. supplier's yard, Mombasa" />
          </div>
          <div className="space-y-1">
            <Label>Expected delivery</Label>
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2 mt-2">
          <Label>Containers</Label>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end rounded-md border p-2">
              <div className="col-span-3 sm:col-span-2 space-y-1">
                <Label className="text-xs">Size</Label>
                <Select value={l.container_size} onValueChange={(v) => set(i, "container_size", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CONTAINER_SIZES.map((s) => <SelectItem key={s} value={s}>{s}ft</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-3 sm:col-span-2 space-y-1">
                <Label className="text-xs">Height</Label>
                <Select value={l.container_height || "none"} disabled={l.container_category !== "dry"}
                        onValueChange={(v) => set(i, "container_height", v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {l.container_category !== "dry" && <SelectItem value="none">—</SelectItem>}
                    <SelectItem value="HC">HC (high cube)</SelectItem>
                    <SelectItem value="LC">LC (standard)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3 sm:col-span-2 space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={l.container_category} onValueChange={(v) => set(i, "container_category", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CONTAINER_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-3 sm:col-span-2 space-y-1">
                <Label className="text-xs">Grade</Label>
                <Select value={l.container_grade} onValueChange={(v) => set(i, "container_grade", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CONTAINER_GRADES.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-3 sm:col-span-1 space-y-1">
                <Label className="text-xs">Qty</Label>
                <Input type="number" min="1" step="1" value={l.quantity} onChange={(e) => set(i, "quantity", e.target.value)} />
              </div>
              <div className="col-span-7 sm:col-span-2 space-y-1">
                <Label className="text-xs">Price each ({currency})</Label>
                <Input type="number" min="0" step="0.01" value={l.unit_price} onChange={(e) => set(i, "unit_price", e.target.value)} />
              </div>
              <div className="col-span-2 sm:col-span-1 flex justify-end">
                <Button type="button" size="icon" variant="ghost" disabled={lines.length === 1} onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])}><Plus className="mr-1 h-3 w-3" />Add line</Button>
            <div className="text-sm">Total <span className="font-mono font-semibold">{formatMoneyCode(total, currency)}</span></div>
          </div>
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : poId ? "Save changes" : "Create order"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- receive
function ReceiveDialog({ po, onClose, onSaved }: { po: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const lines = (po?.po_items ?? []).map((i: any) => ({
    id: i.id, description: i.description, quantity: Number(i.quantity) || 0, received_qty: Number(i.received_qty) || 0,
    container_grade: i.container_grade,
    container_category: i.container_category ?? "dry",
    container_height: i.container_height,
  }));
  const [rows, setRows] = useState<ReceiveUnit[]>(() =>
    rowsForOutstanding(lines, { received_at: today(), depot_id: getWorkingDepotId() ?? null }).map((r) => ({
      ...r, grade: lines.find((l: any) => l.id === r.po_item_id)?.container_grade === "as_is" ? null : lines.find((l: any) => l.id === r.po_item_id)?.container_grade ?? null,
    })),
  );
  const [notes, setNotes] = useState("");
  const [issues, setIssues] = useState<UnitIssue[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showTransport, setShowTransport] = useState(false);

  const { data: customers } = useQuery({
    queryKey: ["customers-pick"],
    queryFn: async () => (await sb.from("customers").select("id, company_name").order("company_name")).data ?? [],
  });
  const { data: depots } = useQuery({
    queryKey: ["depots-pick"],
    queryFn: async () => (await sb.from("depots").select("id, name").order("name")).data ?? [],
  });

  const set = (i: number, k: keyof ReceiveUnit, v: any) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const issueFor = (i: number, f: string) => issues.find((x) => x.row === i && x.field === f);

  const save = useMutation({
    mutationFn: async () => {
      setServerError(null);
      const keep = rows.filter((r) => normalizeContainerNumber(r.container_number) || r.delivery === "direct" || r.customer_id);
      if (!keep.length) throw new Error("Enter at least one container number");
      const found = checkReceiveUnits(keep, lines);
      setIssues(found.map((x) => ({ ...x, row: rows.indexOf(keep[x.row]) })));
      if (found.some((x) => !x.warning)) throw new Error("Please fix the highlighted rows");
      const units = keep.map((r) => ({
        ...r,
        container_number: normalizeContainerNumber(r.container_number),
        transport_cost: Number(r.transport_cost || 0) || null,
        offloading_cost: Number(r.offloading_cost || 0) || null,
      }));
      const { data, error } = await sb.rpc("container_po_receive", { _po_id: po.id, _units: units, _notes: notes || null });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      const n = data?.containers?.length ?? 0;
      const direct = (data?.containers ?? []).filter((c: any) => c.delivery === "direct").length;
      toast({
        title: `${n} container${n === 1 ? "" : "s"} received`,
        description: `${n - direct ? `${n - direct} added to the yard with a gate-in EIR. ` : ""}${direct ? `${direct} delivered direct — raise the sale in Container Sales. ` : ""}Inventory and the supplier payable are posted.`,
      });
      onSaved(); onClose();
    },
    onError: (e: any) => setServerError(e.message),
  });

  if (!po) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive containers — {po.po_number}</DialogTitle>
          <DialogDescription>
            One row per container. Leave a row's number empty to skip it; the rest stay on order.
            Each container joins the yard as ours at the PO price, with a gate-in EIR.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <Button size="sm" variant="ghost" onClick={() => setShowTransport((v) => !v)}>
            <Truck className="mr-1 h-3 w-3" />{showTransport ? "Hide" : "Show"} transport and crane details
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRows((p) => [...p, { po_item_id: lines[0]?.id ?? "", container_number: "", delivery: "yard", received_at: today(), depot_id: getWorkingDepotId() ?? null,
              height_class: (lines[0]?.container_category ?? "dry") === "dry" ? (lines[0]?.container_height === "HC" ? "HC" : "LC") : null }])}>
            <Plus className="mr-1 h-3 w-3" />Add row
          </Button>
        </div>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="rounded-md border p-2 space-y-2">
              <div className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-12 sm:col-span-2 space-y-1">
                  <Label className="text-xs">Line</Label>
                  <Select value={r.po_item_id || undefined} onValueChange={(v) => {
                    const l = lines.find((x: any) => x.id === v);
                    setRows((p) => p.map((row, idx) => idx === i ? {
                      ...row, po_item_id: v,
                      height_class: (l?.container_category ?? "dry") === "dry" ? (l?.container_height === "HC" ? "HC" : "LC") : null,
                    } : row));
                  }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Line" /></SelectTrigger>
                    <SelectContent>{lines.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.description} ({l.received_qty}/{l.quantity})</SelectItem>)}</SelectContent>
                  </Select>
                  <FieldMsg issue={issueFor(i, "po_item_id")} />
                </div>
                <div className="col-span-6 sm:col-span-2 space-y-1">
                  <Label className="text-xs">Container no.</Label>
                  <Input className="h-8 font-mono uppercase" value={r.container_number} placeholder="ABCU1234567"
                         onChange={(e) => set(i, "container_number", e.target.value.toUpperCase())} />
                  <FieldMsg issue={issueFor(i, "container_number")} />
                </div>
                <div className="col-span-6 sm:col-span-2 space-y-1">
                  <Label className="text-xs">Date received</Label>
                  <Input className="h-8" type="date" value={r.received_at ?? ""} max={today()} onChange={(e) => set(i, "received_at", e.target.value)} />
                </div>
                <div className="col-span-6 sm:col-span-1 space-y-1">
                  <Label className="text-xs">Height</Label>
                  {(lines.find((l: any) => l.id === r.po_item_id)?.container_category ?? "dry") === "dry" ? (
                    <Select value={r.height_class ?? undefined} onValueChange={(v) => set(i, "height_class", v)}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="HC/LC" /></SelectTrigger>
                      <SelectContent><SelectItem value="HC">HC</SelectItem><SelectItem value="LC">LC</SelectItem></SelectContent>
                    </Select>
                  ) : <div className="h-8 flex items-center text-xs text-muted-foreground">—</div>}
                  <FieldMsg issue={issueFor(i, "height_class")} />
                </div>
                <div className="col-span-6 sm:col-span-1 space-y-1">
                  <Label className="text-xs">Grade</Label>
                  <Select value={r.grade ?? "none"} onValueChange={(v) => set(i, "grade", v === "none" ? null : v)}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {["A", "B", "C", "D"].map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-6 sm:col-span-1 space-y-1">
                  <Label className="text-xs">Goes to</Label>
                  <Select value={r.delivery} onValueChange={(v) => set(i, "delivery", v)}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yard">Our yard</SelectItem>
                      <SelectItem value="direct">Direct to customer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-11 sm:col-span-2 space-y-1">
                  {r.delivery === "direct" ? (
                    <>
                      <Label className="text-xs">Customer</Label>
                      <Select value={r.customer_id ?? undefined} onValueChange={(v) => set(i, "customer_id", v)}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Customer" /></SelectTrigger>
                        <SelectContent>{(customers ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                      </Select>
                      <FieldMsg issue={issueFor(i, "customer_id")} />
                    </>
                  ) : (
                    <>
                      <Label className="text-xs">Depot</Label>
                      <Select value={r.depot_id ?? undefined} onValueChange={(v) => set(i, "depot_id", v)}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Depot" /></SelectTrigger>
                        <SelectContent>{(depots ?? []).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </>
                  )}
                </div>
                <div className="col-span-1 flex justify-end pt-5">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              {showTransport && (
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                  <Input className="h-8" placeholder="Transporter" value={r.transporter ?? ""} onChange={(e) => set(i, "transporter", e.target.value)} />
                  <Input className="h-8" placeholder="Truck reg." value={r.truck_registration ?? ""} onChange={(e) => set(i, "truck_registration", e.target.value.toUpperCase())} />
                  <Input className="h-8" placeholder="Driver" value={r.driver_name ?? ""} onChange={(e) => set(i, "driver_name", e.target.value)} />
                  <Input className="h-8" placeholder="Driver phone" value={r.driver_phone ?? ""} onChange={(e) => set(i, "driver_phone", e.target.value)} />
                  <div className="col-span-2 grid grid-cols-2 gap-2">
                    <div>
                      <Input className="h-8" placeholder="Transport billed by" value={r.transport_vendor ?? ""} onChange={(e) => set(i, "transport_vendor", e.target.value)} />
                      <FieldMsg issue={issueFor(i, "transport_vendor")} />
                    </div>
                    <Input className="h-8" type="number" min="0" placeholder="Transport cost" value={r.transport_cost ?? ""} onChange={(e) => set(i, "transport_cost", e.target.value)} />
                  </div>
                  {r.delivery === "yard" && (
                    <div className="col-span-2 sm:col-span-3 grid grid-cols-2 gap-2">
                      <div>
                        <Input className="h-8" placeholder="Crane / offloading billed by" value={r.offloading_vendor ?? ""} onChange={(e) => set(i, "offloading_vendor", e.target.value)} />
                        <FieldMsg issue={issueFor(i, "offloading_vendor")} />
                      </div>
                      <Input className="h-8" type="number" min="0" placeholder="Crane cost" value={r.offloading_cost ?? ""} onChange={(e) => set(i, "offloading_cost", e.target.value)} />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {!rows.length && <p className="text-sm text-muted-foreground">Everything on this order has been received.</p>}
        </div>

        <div className="space-y-1">
          <Label>Notes</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery note number, anything to remember" />
        </div>
        {serverError && <Alert variant="destructive"><AlertDescription>{serverError}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !rows.length}>
            {save.isPending ? "Receiving…" : `Receive ${rows.filter((r) => normalizeContainerNumber(r.container_number)).length} container(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldMsg({ issue }: { issue?: UnitIssue }) {
  if (!issue) return null;
  return <p className={`text-[11px] ${issue.warning ? "text-warning" : "text-destructive"}`}>{issue.message}</p>;
}

// ---------------------------------------------------------------- supplier invoice
function BillDialog({ po, onClose, onSaved }: { po: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const s = po?.summary;
  const [ref, setRef] = useState<string>(s?.bill_supplier_ref ?? "");
  const [issue, setIssue] = useState<string>(today());
  const [due, setDue] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      setErr(null);
      const { error } = await sb.rpc("container_po_record_bill", {
        _po_id: po.id, _supplier_ref: ref.trim(), _issue_date: issue || null, _due_date: due || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Supplier invoice recorded" }); onSaved(); onClose(); },
    onError: (e: any) => setErr(e.message),
  });
  if (!po) return null;
  const cur = po.currency ?? getDefaultCurrency();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Supplier invoice — {po.po_number}</DialogTitle>
          <DialogDescription>
            The supplier's invoice for {formatMoneyCode(po.total_cost, cur)}. It can be recorded before or after delivery;
            the amount owed is booked as the containers arrive, and money paid before that is held as an advance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Supplier's invoice number *</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Invoice date</Label><Input type="date" value={issue} onChange={(e) => setIssue(e.target.value)} /></div>
            <div className="space-y-1"><Label>Due date</Label><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} placeholder="30 days" /></div>
          </div>
        </div>
        {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !ref.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- close short
function CloseShortDialog({ po, onClose, onSaved }: { po: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const s = po?.summary;
  const toCome = Math.max((s?.units_ordered ?? 0) - (s?.units_received ?? 0), 0);
  const save = useMutation({
    mutationFn: async () => {
      setErr(null);
      const { data, error } = await sb.rpc("container_po_close_short", { _po_id: po.id, _reason: reason.trim() });
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => {
      const cur = po.currency ?? getDefaultCurrency();
      toast({
        title: d?.status === "cancelled" ? "Order cancelled" : "Order closed",
        description: Number(d?.advance_not_used) > 0
          ? `The supplier holds ${formatMoneyCode(d.advance_not_used, cur)} of ours for containers not delivered — ask for a refund or use it on the next order.`
          : undefined,
      });
      onSaved(); onClose();
    },
    onError: (e: any) => setErr(e.message),
  });
  if (!po) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close short — {po.po_number}</DialogTitle>
          <DialogDescription>
            Stop waiting for the {toCome} container{toCome === 1 ? "" : "s"} not yet delivered. The order and the supplier invoice
            are reduced to what was received{(s?.units_received ?? 0) === 0 ? " — nothing has been received, so the order is cancelled" : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1"><Label>Reason *</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Back</Button>
          <Button variant="destructive" onClick={() => save.mutate()} disabled={save.isPending || !reason.trim()}>Close order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- view
function ViewDialog({ po, onClose }: { po: any; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["container-po-detail", po?.id],
    enabled: !!po?.id,
    queryFn: async () => {
      const [rec, pays] = await Promise.all([
        sb.from("container_po_receipts")
          .select("id, received_at, delivery, unit_cost, currency, po_item_id, containers:container_id(id, container_number, status), customers:customer_id(company_name)")
          .eq("po_id", po.id).order("received_at"),
        sb.from("vendor_payments").select("id, payment_number, amount, currency, paid_at, approval_status").eq("po_id", po.id).order("paid_at"),
      ]);
      return { receipts: rec.data ?? [], payments: pays.data ?? [] };
    },
  });
  if (!po) return null;
  const s = po.summary;
  const cur = po.currency ?? getDefaultCurrency();
  const p = s ? poProgress(s) : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Container className="h-4 w-4" />{po.po_number} · {po.suppliers?.name}</DialogTitle>
          <DialogDescription>
            {po.pickup_location ? `Pick up from ${po.pickup_location}. ` : ""}{po.expected_delivery ? `Expected ${fmtDate(po.expected_delivery)}. ` : ""}
            {po.projects ? `Project ${po.projects.code ?? ""} ${po.projects.name}.` : ""}
          </DialogDescription>
        </DialogHeader>

        {p && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <Mini label="Ordered" value={`${s.units_ordered} · ${formatMoneyCode(po.total_cost, cur)}`} />
            <Mini label="Received" value={`${s.units_received} · ${formatMoneyCode(s.value_received, cur)}`} />
            <Mini label="Supplier invoice" value={s.bill_supplier_ref ?? "not received"} />
            <Mini label="Paid / to pay" value={`${formatMoneyCode(s.paid, cur)} / ${formatMoneyCode(p.toPay, cur)}`} />
          </div>
        )}

        <Table>
          <TableHeader><TableRow><TableHead>Line</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Price</TableHead></TableRow></TableHeader>
          <TableBody>
            {(po.po_items ?? []).map((i: any) => (
              <TableRow key={i.id}>
                <TableCell>{i.description}</TableCell>
                <TableCell className="text-right font-mono">{Number(i.quantity)}</TableCell>
                <TableCell className="text-right font-mono">{Number(i.received_qty || 0)}</TableCell>
                <TableCell className="text-right font-mono">{formatMoneyCode(i.unit_price, cur)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div>
          <Label className="text-sm">Containers received</Label>
          {!data?.receipts?.length ? <p className="text-sm text-muted-foreground mt-1">None yet.</p> : (
            <Table>
              <TableBody>
                {data.receipts.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">
                      <a className="hover:underline" href={`/inventory/${r.containers?.id}`}>{r.containers?.container_number}</a>
                    </TableCell>
                    <TableCell className="text-xs">{fmtDate(r.received_at)}</TableCell>
                    <TableCell className="text-xs">{r.delivery === "direct" ? `Direct to ${r.customers?.company_name ?? "customer"}` : "Yard"}</TableCell>
                    <TableCell><Badge variant="secondary" className="text-[10px]">{r.containers?.status}</Badge></TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatMoneyCode(r.unit_cost, r.currency ?? cur)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div>
          <Label className="text-sm">Payments</Label>
          {!data?.payments?.length ? <p className="text-sm text-muted-foreground mt-1">None yet — use the status menu → Pay supplier. Paying before delivery is fine.</p> : (
            <Table>
              <TableBody>
                {data.payments.map((v: any) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono text-xs">{v.payment_number}</TableCell>
                    <TableCell className="text-xs">{fmtDate(v.paid_at)}</TableCell>
                    <TableCell className="text-xs">{v.approval_status === "pending" ? "awaiting approval" : ""}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatMoneyCode(v.amount, v.currency ?? cur)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <ApprovalTimeline docType="purchase_order" docId={po.id} />
      </DialogContent>
    </Dialog>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono text-xs truncate" title={value}>{value}</div>
    </div>
  );
}
