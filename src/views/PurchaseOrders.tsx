import React, { useState } from "react";
import { getDefaultCurrency } from "@/lib/finance-format";
import { formatMoneyCode } from "@/lib/money";
import { sourceLabel, sourceBadgeClass } from "@/components/finance/PoRecipientPreview";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useOrganization } from "@/hooks/use-organization";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApprovalTimeline } from "@/components/approvals/ApprovalTimeline";
import PoStatusCell from "@/components/procurement/PoStatusCell";

import { Plus, ShoppingBag, PackageCheck, ArrowDownToLine, RotateCcw, Trash2, Package, Pencil, AlertCircle, Eye, Printer } from "lucide-react";
import { printPurchaseOrder } from "@/lib/document-templates";
import { getPrintDepot } from "@/lib/app-settings";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { z } from "zod";

const EDITABLE_STATUSES: string[] = ["draft", "sent"];

const poLineSchema = z.object({
  description: z.string().trim().min(1, "Description required").max(500),
  quantity: z.number().positive("Qty must be > 0").finite(),
  unit_price: z.number().min(0, "Price must be ≥ 0").finite(),
  material_id: z.string().uuid("Pick a catalogue material so receipts update stock"),
  is_vatable: z.boolean().default(false),
  tax_rate: z.number().min(0).max(100).default(0),
});

const poFormSchema = z.object({
  supplier_id: z.string().uuid("Select a supplier"),
  conversion_id: z.string().uuid().optional().or(z.literal("")),
  project_id: z.string().uuid().optional().or(z.literal("")),
  prices_include_tax: z.boolean().default(false),
  freight_amount: z.number().min(0).default(0),
  other_charges_amount: z.number().min(0).default(0),
  lineItems: z.array(poLineSchema).min(1, "Add at least one line item"),
});

type LineErrors = Partial<Record<keyof z.infer<typeof poLineSchema>, string>>;
interface PoFormErrors {
  supplier_id?: string;
  form?: string;
  lines?: Record<number, LineErrors>;
}

const statusColor: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-info/15 text-info dark:bg-info/30 dark:text-info",
  confirmed: "bg-warning/15 text-warning dark:bg-warning/30 dark:text-warning",
  partially_received: "bg-warning/15 text-warning dark:bg-warning/30 dark:text-warning",
  received: "bg-success/15 text-success dark:bg-success/30 dark:text-success",
  cancelled: "bg-destructive/15 text-destructive dark:bg-destructive/30 dark:text-destructive",
  paid: "bg-success/15 text-success dark:bg-success/30 dark:text-success",
};

interface POLineItem {
  material_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  is_vatable: boolean;
  tax_rate: string;
}

// ─── Purchase Orders Tab ────────────────────────────────────────────
function PurchaseOrdersTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingPoId, setEditingPoId] = useState<string | null>(null);
  const [viewPoId, setViewPoId] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState<string | null>(null);
  const [receiptNotes, setReceiptNotes] = useState("");
  const [receiptLines, setReceiptLines] = useState<Record<string, { received: string; reason: string }>>({});
  const [form, setForm] = useState({ supplier_id: "", conversion_id: "", project_id: "", prices_include_tax: false, freight_amount: "0", other_charges_amount: "0" });
  const [lineItems, setLineItems] = useState<POLineItem[]>([{ material_id: "", description: "", quantity: "1", unit_price: "", is_vatable: false, tax_rate: "0" }]);
  const [quickMatOpen, setQuickMatOpen] = useState(false);
  const [quickMatForm, setQuickMatForm] = useState({ name: "", unit: "pcs", unit_cost: "", category: "" });
  const [quickMatLineIdx, setQuickMatLineIdx] = useState<number>(0);

  const resetForm = () => {
    setForm({ supplier_id: "", conversion_id: "", project_id: "", prices_include_tax: false, freight_amount: "0", other_charges_amount: "0" });
    setLineItems([{ material_id: "", description: "", quantity: "1", unit_price: "", is_vatable: false, tax_rate: "0" }]);
    setEditingPoId(null);
    setErrors({});
  };

  const [errors, setErrors] = useState<PoFormErrors>({});

  const validate = (): { ok: boolean; parsed?: z.infer<typeof poFormSchema> } => {
    const payload = {
      supplier_id: form.supplier_id,
      conversion_id: form.conversion_id,
      project_id: form.project_id,
      prices_include_tax: !!form.prices_include_tax,
      freight_amount: Number(form.freight_amount) || 0,
      other_charges_amount: Number(form.other_charges_amount) || 0,
      lineItems: lineItems.map((li) => ({
        description: li.description.trim(),
        quantity: Number(li.quantity),
        unit_price: Number(li.unit_price),
        material_id: li.material_id || "",
        is_vatable: !!li.is_vatable,
        tax_rate: Number(li.tax_rate) || 0,
      })),
    };
    const result = poFormSchema.safeParse(payload);
    if (result.success) {
      setErrors({});
      return { ok: true, parsed: result.data };
    }
    const next: PoFormErrors = { lines: {} };
    for (const issue of result.error.issues) {
      const [head, idx, field] = issue.path;
      if (head === "lineItems" && typeof idx === "number" && typeof field === "string") {
        next.lines![idx] = { ...(next.lines![idx] ?? {}), [field]: issue.message };
      } else if (head === "supplier_id") {
        next.supplier_id = issue.message;
      } else if (head === "lineItems") {
        next.form = issue.message;
      }
    }
    setErrors(next);
    return { ok: false };
  };

  const openEdit = (po: any) => {
    if (!EDITABLE_STATUSES.includes(po.status)) {
      toast({ title: "Cannot edit", description: `PO is ${po.status}. Only draft or sent POs are editable.`, variant: "destructive" });
      return;
    }
    setEditingPoId(po.id);
    setErrors({});
    setForm({ supplier_id: po.supplier_id ?? "", conversion_id: po.conversion_id ?? "", project_id: (po as any).project_id ?? "", prices_include_tax: !!po.prices_include_tax, freight_amount: String(po.freight_amount ?? "0"), other_charges_amount: String(po.other_charges_amount ?? "0") });
    const items = (po.po_items ?? []) as any[];
    setLineItems(items.length ? items.map((it) => ({
      material_id: it.material_id ?? "",
      description: it.description ?? "",
      quantity: String(it.quantity ?? "1"),
      unit_price: String(it.unit_price ?? ""),
      is_vatable: !!it.is_vatable,
      tax_rate: String(it.tax_rate ?? "0"),
    })) : [{ material_id: "", description: "", quantity: "1", unit_price: "", is_vatable: false, tax_rate: "0" }]);
    setOpen(true);
  };

  const { data: purchaseOrders, isLoading } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("*, suppliers(name, contact_person, phone, email, address, currency), container_conversions:conversion_id(conversion_number), po_items(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name, currency").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: conversions } = useQuery({
    queryKey: ["conversions-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("container_conversions").select("id, conversion_number, project_id").in("status", ["planning", "in_progress"]).order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: projectsList } = useQuery({
    queryKey: ["projects-active-po"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, code, name").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: materials } = useQuery({
    queryKey: ["materials-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materials").select("id, name, unit, unit_cost, is_vatable").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  // Branding is sourced from the active working depot (falls back to org).
  const depot = getPrintDepot();

  const handlePrintPo = (po: any) => {
    printPurchaseOrder({
      po_number: po.po_number,
      status: po.status,
      created_at: po.created_at,
      total_cost: Number(po.total_cost) || 0,
      currency: po.suppliers?.currency ?? getDefaultCurrency(),
      notes: po.notes ?? null,
      conversion_number: po.container_conversions?.conversion_number ?? null,
      supplier: po.suppliers ?? null,
      line_items: (po.po_items ?? []).map((it: any) => ({
        description: it.description ?? "",
        quantity: Number(it.quantity) || 0,
        unit_price: Number(it.unit_price) || 0,
        total_cost: Number(it.total_cost) || 0,
      })),
      depot: depot ? { name: depot.name, code: depot.code, location: depot.location, logo_url: depot.logo_url } : null,
      issuer_name: user?.email ?? null,
    });
  };

  const addLine = () => setLineItems((p) => [...p, { material_id: "", description: "", quantity: "1", unit_price: "", is_vatable: false, tax_rate: "0" }]);
  const removeLine = (i: number) => setLineItems((p) => p.filter((_, idx) => idx !== i));
  const updateLine = (i: number, k: keyof POLineItem, v: string | boolean) => {
    setLineItems((p) => {
      const n = [...p];
      n[i] = { ...n[i], [k]: v as any };
      // Auto-fill from material catalog
      if (k === "material_id" && v && materials) {
        const mat = materials.find((m: any) => m.id === v);
        if (mat) {
          n[i].description = (mat as any).name;
          n[i].unit_price = String((mat as any).unit_cost);
          if ((mat as any).is_vatable) n[i].is_vatable = true;
        }
      }
      return n;
    });
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const v = validate();
      if (!v.ok || !v.parsed) throw new Error("Please fix the highlighted fields");
      const { supplier_id, conversion_id, project_id, prices_include_tax, freight_amount, other_charges_amount, lineItems: items } = v.parsed;
      const num = `PO-${Date.now().toString(36).toUpperCase()}`;
      const { data: po, error } = await supabase.from("purchase_orders").insert({
        po_number: num,
        supplier_id,
        conversion_id: conversion_id || null,
        project_id: project_id || null,
        prices_include_tax,
        freight_amount,
        other_charges_amount,
        total_cost: 0,
        created_by: user?.id,
      } as any).select("id").single();
      if (error) throw error;
      const rows = items.map((li) => ({
        po_id: po.id,
        material_id: li.material_id || null,
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unit_price,
        total_cost: li.quantity * li.unit_price,
        is_vatable: li.is_vatable,
        tax_rate: li.tax_rate,
      }));
      const { error: e2 } = await supabase.from("po_items").insert(rows as any);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast({ title: "Purchase order created" });
      setOpen(false);
      resetForm();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updatePoMut = useMutation({
    mutationFn: async () => {
      if (!editingPoId) throw new Error("No PO selected");
      const { data: current, error: cErr } = await supabase.from("purchase_orders").select("status").eq("id", editingPoId).single();
      if (cErr) throw cErr;
      const curStatus = (current as any).status;
      if (!EDITABLE_STATUSES.includes(curStatus)) {
        throw new Error(`PO is ${curStatus} — editing is locked once it leaves draft/sent.`);
      }
      const v = validate();
      if (!v.ok || !v.parsed) throw new Error("Please fix the highlighted fields");
      const { supplier_id, conversion_id, project_id, prices_include_tax, freight_amount, other_charges_amount, lineItems: items } = v.parsed;
      const { error: uErr } = await supabase.from("purchase_orders").update({
        supplier_id,
        conversion_id: conversion_id || null,
        project_id: project_id || null,
        prices_include_tax,
        freight_amount,
        other_charges_amount,
      } as any).eq("id", editingPoId).in("status", EDITABLE_STATUSES);
      if (uErr) throw uErr;
      const { error: dErr } = await supabase.from("po_items").delete().eq("po_id", editingPoId);
      if (dErr) throw dErr;
      const rows = items.map((li) => ({
        po_id: editingPoId,
        material_id: li.material_id || null,
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unit_price,
        total_cost: li.quantity * li.unit_price,
        is_vatable: li.is_vatable,
        tax_rate: li.tax_rate,
      }));
      const { error: iErr } = await supabase.from("po_items").insert(rows as any);
      if (iErr) throw iErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast({ title: "Purchase order updated" });
      setOpen(false);
      resetForm();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });




  const recordReceipt = useMutation({
    mutationFn: async (poId: string) => {
      const po = purchaseOrders?.find((p: any) => p.id === poId) as any;
      if (!po) throw new Error("PO not found");
      const lines = (po.po_items || []).map((it: any) => {
        const outstanding = Math.max(Number(it.quantity) - Number(it.received_qty ?? 0), 0);
        const entry = receiptLines[it.id] || { received: String(outstanding), reason: "" };
        const received = Number(entry.received);
        if (!isFinite(received) || received < 0) throw new Error(`Invalid received qty for "${it.description}"`);
        if (received !== outstanding && !entry.reason.trim()) {
          throw new Error(`Reason required for "${it.description}" (qty differs from outstanding)`);
        }
        return {
          po_item_id: it.id,
          received_qty: received,
          reason: entry.reason || null,
          allow_over: outstanding <= 0 && received > 0,
        };
      });

      const { data, error } = await supabase.rpc("receive_po_with_variances" as any, {
        _po_id: poId,
        _notes: receiptNotes || null,
        _lines: lines,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["materials-catalog"] });
      qc.invalidateQueries({ queryKey: ["goods-receipts-all"] });
      qc.invalidateQueries({ queryKey: ["approval-requests"] });
      const pending = data?.approval_status === "pending_approval";
      toast({
        title: pending ? "Submitted for approval" : "Goods receipt recorded",
        description: pending
          ? "Variance detected — inventory and supplier documents will post once a manager approves."
          : "Stock updated.",
      });
      setReceiptOpen(null);
      setReceiptNotes("");
      setReceiptLines({});
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const quickCreateMat = useMutation({
    mutationFn: async () => {
      const { data: mat, error } = await supabase.from("materials").insert({
        name: quickMatForm.name,
        unit: quickMatForm.unit,
        unit_cost: parseFloat(quickMatForm.unit_cost) || 0,
        category: quickMatForm.category || null,
      } as any).select("id, name, unit, unit_cost").single();
      if (error) throw error;
      await supabase.from("material_stock").insert({ material_id: mat.id, qty_available: 0, qty_reserved: 0 } as any);
      return mat;
    },
    onSuccess: (mat) => {
      qc.invalidateQueries({ queryKey: ["materials-active"] });
      qc.invalidateQueries({ queryKey: ["materials-catalog"] });
      updateLine(quickMatLineIdx, "material_id", mat.id);
      updateLine(quickMatLineIdx, "description", mat.name);
      updateLine(quickMatLineIdx, "unit_price", String(mat.unit_cost));
      toast({ title: "Material created & selected" });
      setQuickMatOpen(false);
      setQuickMatForm({ name: "", unit: "pcs", unit_cost: "", category: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{purchaseOrders?.length ?? 0} orders</p>
        <Button onClick={() => { resetForm(); setOpen(true); }} size="sm"><Plus className="mr-1 h-4 w-4" />New PO</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !purchaseOrders?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No purchase orders yet</TableCell></TableRow>
              ) : purchaseOrders.map((po: any) => (
                <TableRow key={po.id}>
                  <TableCell className="font-mono text-xs">{po.po_number}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex flex-col gap-1">
                      <span>{po.suppliers?.name ?? "—"}</span>
                      {po.po_number?.startsWith("PO-ACQ") && po.recipient_source && (
                        <Badge
                          variant="secondary"
                          className={`w-fit text-[10px] ${sourceBadgeClass(po.recipient_source)}`}
                          title={po.recipient_resolution_note ?? undefined}
                        >
                          {sourceLabel(po.recipient_source)}

                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">{po.container_conversions?.conversion_number ?? "—"}</TableCell>
                  <TableCell className="text-sm">{po.po_items?.length ?? 0} items</TableCell>
                  <TableCell className="text-right font-mono">{formatMoneyCode(po.total_cost, po.currency ?? po.suppliers?.currency ?? getDefaultCurrency())}</TableCell>
                  <TableCell>
                    <PoStatusCell poId={po.id} status={po.status} />
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground">{format(new Date(po.created_at), "dd MMM yyyy")}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setViewPoId(po.id)} title="View PO">
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handlePrintPo(po)} title="Print PO">
                        <Printer className="h-3 w-3" />
                      </Button>
                      {["draft", "sent"].includes(po.status) && (
                        <Button size="sm" variant="ghost" onClick={() => openEdit(po)} title="Edit PO">
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                      {["confirmed", "partially_received"].includes(po.status) && (
                        <Button size="sm" variant="outline" onClick={() => {
                          const init: Record<string, { received: string; reason: string }> = {};
                          (po.po_items || []).forEach((it: any) => { init[it.id] = { received: String(it.quantity), reason: "" }; });
                          setReceiptLines(init);
                          setReceiptOpen(po.id);
                        }}>
                          <PackageCheck className="mr-1 h-3 w-3" />Receive
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create / Edit PO Dialog */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPoId ? "Edit Purchase Order" : "New Purchase Order"}</DialogTitle>
            <DialogDescription>{editingPoId ? "Update header and line items. Allowed while PO is draft or sent." : "Create a purchase order with multiple line items linked to your materials catalog."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); editingPoId ? updatePoMut.mutate() : createMut.mutate(); }} className="space-y-4">
            {errors.form && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errors.form}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Supplier *</Label>
                <Select value={form.supplier_id} onValueChange={(v) => { setForm((f) => ({ ...f, supplier_id: v })); setErrors((e) => ({ ...e, supplier_id: undefined })); }}>
                  <SelectTrigger aria-invalid={!!errors.supplier_id} className={errors.supplier_id ? "border-destructive" : undefined}><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>{suppliers?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
                {errors.supplier_id && <p className="text-xs text-destructive">{errors.supplier_id}</p>}
              </div>
              <div className="space-y-2">
                <Label>Project</Label>
                <Select
                  value={form.project_id}
                  onValueChange={(v) => setForm((f) => ({ ...f, project_id: v, conversion_id: "" }))}
                >
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>{projectsList?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ""}{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Linked Job</Label>
                <Select value={form.conversion_id} onValueChange={(v) => setForm((f) => ({ ...f, conversion_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {(conversions ?? [])
                      .filter((c: any) => !form.project_id || c.project_id === form.project_id)
                      .map((c: any) => <SelectItem key={c.id} value={c.id}>{c.conversion_number}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 rounded-md border p-3 bg-muted/30">
              <div className="space-y-2 col-span-3 sm:col-span-1 flex items-center gap-2">
                <input
                  id="prices_include_tax"
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.prices_include_tax}
                  onChange={(e) => setForm((f) => ({ ...f, prices_include_tax: e.target.checked }))}
                />
                <Label htmlFor="prices_include_tax" className="cursor-pointer text-sm">Prices include VAT</Label>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Freight / Transport</Label>
                <Input type="number" min="0" step="any" value={form.freight_amount} onChange={(e) => setForm((f) => ({ ...f, freight_amount: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Other Charges</Label>
                <Input type="number" min="0" step="any" value={form.other_charges_amount} onChange={(e) => setForm((f) => ({ ...f, other_charges_amount: e.target.value }))} placeholder="0.00" />
              </div>
              <p className="text-xs text-muted-foreground col-span-3">Freight and other charges are allocated across line items in proportion to each line's value contribution (landed cost).</p>
            </div>



            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Line Items</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addLine}><Plus className="mr-1 h-3 w-3" />Add</Button>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {lineItems.map((li, i) => {
                  const lineErr = errors.lines?.[i] ?? {};
                  return (
                  <div key={i} className="space-y-1">
                    <div className="grid grid-cols-[1fr_1fr_70px_90px_70px_70px_32px] gap-2 items-end">
                      <div>
                        {i === 0 && <Label className="text-xs text-muted-foreground">Material *</Label>}
                        <div className="flex gap-1">
                          <Select value={li.material_id} onValueChange={(v) => updateLine(i, "material_id", v)}>
                            <SelectTrigger className={`h-9 ${lineErr.material_id ? "border-destructive" : ""}`}><SelectValue placeholder="Select..." /></SelectTrigger>
                            <SelectContent>{materials?.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit})</SelectItem>)}</SelectContent>
                          </Select>
                          <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Create new material" onClick={() => { setQuickMatLineIdx(i); setQuickMatOpen(true); }}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        {lineErr.material_id && <p className="text-[11px] text-destructive mt-1">{lineErr.material_id}</p>}
                      </div>

                      <div>
                        {i === 0 && <Label className="text-xs text-muted-foreground">Description</Label>}
                        <Input aria-invalid={!!lineErr.description} className={`h-9 ${lineErr.description ? "border-destructive" : ""}`} value={li.description} onChange={(e) => updateLine(i, "description", e.target.value)} placeholder="Description" />
                      </div>
                      <div>
                        {i === 0 && <Label className="text-xs text-muted-foreground">Qty</Label>}
                        <Input aria-invalid={!!lineErr.quantity} className={`h-9 ${lineErr.quantity ? "border-destructive" : ""}`} type="number" min="0" step="any" value={li.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                      </div>
                      <div>
                        {i === 0 && <Label className="text-xs text-muted-foreground">Price</Label>}
                        <Input aria-invalid={!!lineErr.unit_price} className={`h-9 ${lineErr.unit_price ? "border-destructive" : ""}`} type="number" min="0" step="any" value={li.unit_price} onChange={(e) => updateLine(i, "unit_price", e.target.value)} />
                      </div>
                      <div>
                        {i === 0 && <Label className="text-xs text-muted-foreground" title="VATable">VAT</Label>}
                        <div className="h-9 flex items-center justify-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-primary"
                            checked={li.is_vatable}
                            onChange={(e) => updateLine(i, "is_vatable", e.target.checked)}
                            title="Mark line as VATable"
                          />
                        </div>
                      </div>
                      <div>
                        {i === 0 && <Label className="text-xs text-muted-foreground">VAT %</Label>}
                        <Input
                          className="h-9"
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          value={li.tax_rate}
                          onChange={(e) => updateLine(i, "tax_rate", e.target.value)}
                          disabled={!li.is_vatable}
                          placeholder="0"
                        />
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => removeLine(i)} disabled={lineItems.length === 1}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    {(lineErr.description || lineErr.quantity || lineErr.unit_price) && (
                      <p className="text-xs text-destructive pl-1">
                        {[lineErr.description, lineErr.quantity, lineErr.unit_price].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  );
                })}
              </div>
              {(() => {
                const inclusive = form.prices_include_tax;
                const freight = Number(form.freight_amount) || 0;
                const other = Number(form.other_charges_amount) || 0;
                let netTotal = 0, taxTotal = 0;
                lineItems.forEach((li) => {
                  const gross = (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0);
                  const rate = li.is_vatable ? (parseFloat(li.tax_rate) || 0) / 100 : 0;
                  const net = inclusive ? gross / (1 + rate) : gross;
                  const tax = inclusive ? gross - net : net * rate;
                  netTotal += net; taxTotal += tax;
                });
                const grand = netTotal + taxTotal + freight + other;
                return (
                  <div className="text-right text-sm space-y-0.5">
                    <div>Net: <span className="font-mono">{netTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    <div>VAT: <span className="font-mono">{taxTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    {(freight > 0 || other > 0) && (
                      <div>Freight + Other: <span className="font-mono">{(freight + other).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    )}
                    <div className="font-semibold border-t pt-0.5">Total: <span className="font-mono">{grand.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                  </div>
                );
              })()}
            </div>
            <Button type="submit" className="w-full" disabled={(editingPoId ? updatePoMut.isPending : createMut.isPending) || !form.supplier_id}>{editingPoId ? "Update PO" : "Create PO"}</Button>
            {editingPoId && <ApprovalTimeline docType="purchase_order" docId={editingPoId} />}
          </form>
        </DialogContent>
      </Dialog>

      {/* Goods Receipt Dialog */}
      <Dialog open={!!receiptOpen} onOpenChange={(o) => { if (!o) { setReceiptOpen(null); setReceiptLines({}); setReceiptNotes(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record Goods Receipt</DialogTitle>
            <DialogDescription>Enter the actual quantity received for each line. Reason is required when it differs from the PO. Over-received lines auto-raise a supplementary PO and supplier invoice.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {receiptOpen && purchaseOrders && (() => {
              const po = purchaseOrders.find((p: any) => p.id === receiptOpen) as any;
              if (!po?.po_items?.length) return <p className="text-sm text-muted-foreground">No items on this PO.</p>;
              let overCount = 0;
              let unlinkedCount = 0;
              po.po_items.forEach((it: any) => {
                const outstanding = Math.max(Number(it.quantity) - Number(it.received_qty ?? 0), 0);
                const r = Number(receiptLines[it.id]?.received ?? outstanding);
                if (r > outstanding) overCount++;
                if (!it.material_id && r > 0) unlinkedCount++;
              });
              return (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right w-24">Outstanding</TableHead>
                        <TableHead className="text-right w-28">Received now</TableHead>
                        <TableHead className="w-32">Variance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {po.po_items.map((item: any) => {
                        const ordered = Number(item.quantity);
                        const alreadyReceived = Number(item.received_qty ?? 0);
                        const outstanding = Math.max(ordered - alreadyReceived, 0);
                        const entry = receiptLines[item.id] || { received: String(outstanding), reason: "" };
                        const received = Number(entry.received);
                        const diff = received - outstanding;
                        const variant = diff === 0 ? "Exact" : diff < 0 ? `Short by ${Math.abs(diff)}` : `Over by ${diff}`;
                        const variantClass = diff === 0 ? "text-muted-foreground" : diff < 0 ? "text-warning" : "text-info";
                        return (
                          <React.Fragment key={item.id}>
                            <TableRow>
                              <TableCell className="text-sm">
                                {item.description}
                                <div className="text-xs text-muted-foreground">
                                  Ordered {ordered} · already received {alreadyReceived}
                                </div>
                                {!item.material_id && (
                                  <div className="text-xs text-warning">
                                    No material linked — this line will not update inventory.
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono">{outstanding}</TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={entry.received}
                                  onChange={(e) => setReceiptLines({ ...receiptLines, [item.id]: { ...entry, received: e.target.value } })}
                                  className="h-8 text-right font-mono"
                                />
                              </TableCell>
                              <TableCell className={`text-xs ${variantClass}`}>{variant}</TableCell>
                            </TableRow>
                            {diff !== 0 && (
                              <TableRow>
                                <TableCell colSpan={4} className="pt-0">
                                  <Input
                                    placeholder={`Reason for ${diff < 0 ? "shortage" : "excess"} (required)`}
                                    value={entry.reason}
                                    onChange={(e) => setReceiptLines({ ...receiptLines, [item.id]: { ...entry, reason: e.target.value } })}
                                    className="h-8 text-xs"
                                  />
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {unlinkedCount > 0 && (
                    <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                      {unlinkedCount} line{unlinkedCount > 1 ? "s have" : " has"} no catalogue material attached, so stock will not move.
                      You can attach a material to the line from the Goods Receipts tab after posting.
                    </div>
                  )}
                  {overCount > 0 && (
                    <div className="rounded-md border border-info/40 bg-info/10 p-3 text-xs text-info">
                      A supplementary PO and supplier invoice will be raised to <strong>{po.suppliers?.name ?? "the supplier"}</strong> for the excess on {overCount} line{overCount > 1 ? "s" : ""}.
                    </div>
                  )}
                </>
              );

            })()}
            <div className="space-y-2"><Label>Notes</Label><Textarea value={receiptNotes} onChange={(e) => setReceiptNotes(e.target.value)} placeholder="Receipt notes..." /></div>
            <Button className="w-full" onClick={() => receiptOpen && recordReceipt.mutate(receiptOpen)} disabled={recordReceipt.isPending}>
              <PackageCheck className="mr-1 h-4 w-4" />Confirm Receipt & Update Stock
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* View PO Dialog */}
      <Dialog open={!!viewPoId} onOpenChange={(o) => { if (!o) setViewPoId(null); }}>
        <DialogContent className="max-w-3xl">
          {viewPoId && (() => {
            const po = purchaseOrders?.find((p: any) => p.id === viewPoId) as any;
            if (!po) return <p className="text-sm text-muted-foreground">PO not found.</p>;
            const curr = po.currency ?? po.suppliers?.currency ?? getDefaultCurrency();
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <span className="font-mono">{po.po_number}</span>
                    <Badge className={statusColor[po.status] ?? ""} variant="secondary">{po.status}</Badge>
                  </DialogTitle>
                  <DialogDescription>Issued {format(new Date(po.created_at), "dd MMM yyyy HH:mm")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-xs uppercase text-muted-foreground mb-1">Supplier</div>
                      <div className="font-medium">{po.suppliers?.name ?? "—"}</div>
                      {po.suppliers?.contact_person && <div className="text-xs text-muted-foreground">{po.suppliers.contact_person}</div>}
                      {po.suppliers?.phone && <div className="text-xs text-muted-foreground">{po.suppliers.phone}</div>}
                      {po.suppliers?.email && <div className="text-xs text-muted-foreground">{po.suppliers.email}</div>}
                      {po.suppliers?.address && <div className="text-xs text-muted-foreground">{po.suppliers.address}</div>}
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground mb-1">Job Ref</div>
                      <div className="font-mono">{po.container_conversions?.conversion_number ?? "—"}</div>
                      <div className="text-xs uppercase text-muted-foreground mt-3 mb-1">Total</div>
                      <div className="text-lg font-bold">{curr} {Number(po.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(po.po_items ?? []).map((it: any, i: number) => (
                        <TableRow key={it.id ?? i}>
                          <TableCell className="text-xs">{i + 1}</TableCell>
                          <TableCell className="text-sm">{it.description}</TableCell>
                          <TableCell className="text-right font-mono">{Number(it.quantity).toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono">{Number(it.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell className="text-right font-mono">{Number(it.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {po.notes && (
                    <div className="text-sm"><span className="text-xs uppercase text-muted-foreground mr-2">Notes</span>{po.notes}</div>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setViewPoId(null)}>Close</Button>
                    <Button onClick={() => handlePrintPo(po)}><Printer className="mr-1 h-4 w-4" />Print</Button>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Quick Create Material Dialog */}
      <Dialog open={quickMatOpen} onOpenChange={setQuickMatOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quick Add Material</DialogTitle>
            <DialogDescription>Create a new material and auto-select it on the PO line.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); quickCreateMat.mutate(); }} className="space-y-4">
            <div className="space-y-2"><Label>Name *</Label><Input value={quickMatForm.name} onChange={(e) => setQuickMatForm((f) => ({ ...f, name: e.target.value }))} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select value={quickMatForm.unit} onValueChange={(v) => setQuickMatForm((f) => ({ ...f, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["pcs", "kg", "m", "sheets", "litres"].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Unit Cost</Label><Input type="number" value={quickMatForm.unit_cost} onChange={(e) => setQuickMatForm((f) => ({ ...f, unit_cost: e.target.value }))} /></div>
            </div>
            <div className="space-y-2"><Label>Category</Label><Input value={quickMatForm.category} onChange={(e) => setQuickMatForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Steel, Electrical" /></div>
            <Button type="submit" className="w-full" disabled={quickCreateMat.isPending || !quickMatForm.name}>Create & Select</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Goods Receipts Tab ─────────────────────────────────────────────
const APPROVAL_BADGE: Record<string, string> = {
  auto_posted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  pending_approval: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-destructive/15 text-destructive",
};

function GoodsReceiptsTab() {
  const [auditFor, setAuditFor] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<{ itemId: string; label: string } | null>(null);
  const [linkMaterial, setLinkMaterial] = useState("");
  const { organizationId, organizationName } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: linkableMaterials } = useQuery({
    queryKey: ["materials-linkable"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materials").select("id, name, unit").eq("is_active", true).order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const linkMut = useMutation({
    mutationFn: async () => {
      if (!linkFor || !linkMaterial) throw new Error("Select a material");
      const { error } = await supabase.rpc("link_receipt_item_to_material" as any, {
        _receipt_item_id: linkFor.itemId,
        _material_id: linkMaterial,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Material linked", description: "Stock has been posted for this receipt line." });
      setLinkFor(null);
      setLinkMaterial("");
      qc.invalidateQueries();
    },
    onError: (e: any) => toast({ title: "Could not link material", description: e.message, variant: "destructive" }),
  });


  const { data: receipts, isLoading } = useQuery({
    queryKey: ["goods-receipts-all", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goods_receipts")
        .select("*, purchase_orders:po_id(po_number, suppliers(name)), supplementary:supplementary_po_id(po_number), credit_note:credit_note_invoice_id(invoice_number), goods_receipt_items(*, po_items(description, material_id, quantity))")
        .eq("organization_id", organizationId!)
        .order("received_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });


  const { data: auditRows } = useQuery({
    queryKey: ["gr-audit", auditFor],
    enabled: !!auditFor,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goods_receipt_audit" as any)
        .select("*")
        .eq("receipt_id", auditFor!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });

  return (
    <>
      <div className="flex items-center justify-between mb-3 text-sm">
        <div className="text-muted-foreground">
          Showing receipts for <span className="font-medium text-foreground">{organizationName ?? "…"}</span>
        </div>
        <div className="text-muted-foreground">{receipts?.length ?? 0} receipt{(receipts?.length ?? 0) === 1 ? "" : "s"} loaded</div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Lines (ord → recv)</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead>Auto docs</TableHead>
                <TableHead>Received At</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !receipts?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No goods receipts in <span className="font-medium text-foreground">{organizationName ?? "this organization"}</span>. Switch organization from the sidebar to view another tenant's receipts.
                </TableCell></TableRow>

              ) : receipts.map((r: any) => (
                <TableRow key={r.id} className={r.is_void ? "opacity-60" : undefined}>
                  <TableCell className="font-mono text-xs">
                    {r.purchase_orders?.po_number ?? "—"}
                    {r.is_void && <Badge variant="outline" className="ms-1 text-[10px] py-0 text-destructive border-destructive/40">void</Badge>}
                  </TableCell>
                  <TableCell className="font-medium">{r.purchase_orders?.suppliers?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.goods_receipt_items?.map((gi: any) => {
                      const variance = Number(gi.received_qty) - Number(gi.ordered_qty ?? gi.po_items?.quantity ?? 0);
                      const unlinked = !gi.po_items?.material_id;
                      return (
                        <div key={gi.id} className="text-xs flex items-center gap-1 flex-wrap">
                          <span className="truncate max-w-[180px]">{gi.po_items?.description}</span>
                          <span className="font-mono">{gi.ordered_qty ?? gi.po_items?.quantity} → {gi.received_qty}</span>
                          {variance !== 0 && (
                            <Badge variant="outline" className="text-[10px] py-0">
                              {variance > 0 ? `+${variance}` : variance}
                            </Badge>
                          )}
                          {unlinked && !r.is_void && (
                            <>
                              <Badge variant="outline" className="text-[10px] py-0 text-warning border-warning/40">
                                not in stock — no material linked
                              </Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 px-1 text-[10px] text-warning"
                                onClick={() => { setLinkFor({ itemId: gi.id, label: gi.po_items?.description ?? "line" }); setLinkMaterial(""); }}
                              >
                                Link material
                              </Button>
                            </>
                          )}

                        </div>
                      );
                    })}
                  </TableCell>

                  <TableCell>
                    <Badge className={APPROVAL_BADGE[r.approval_status] || "bg-muted"}>
                      {(r.approval_status || "auto_posted").replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.supplementary?.po_number && <div>Sup PO: <span className="font-mono">{r.supplementary.po_number}</span></div>}
                    {r.credit_note?.invoice_number && <div>Credit: <span className="font-mono">{r.credit_note.invoice_number}</span></div>}
                    {!r.supplementary?.po_number && !r.credit_note?.invoice_number && <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(r.received_at), "dd MMM yyyy HH:mm")}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => setAuditFor(r.id)}>
                      <Eye className="h-4 w-4 mr-1" />Audit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!linkFor} onOpenChange={(v) => !v && setLinkFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link receipt line to a material</DialogTitle>
            <DialogDescription>
              "{linkFor?.label}" was received as free text. Linking it to a catalogue material posts the received
              quantity into stock.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Material</Label>
            <Select value={linkMaterial} onValueChange={setLinkMaterial}>
              <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
              <SelectContent>
                {linkableMaterials?.map((m: any) => (
                  <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="w-full" disabled={!linkMaterial || linkMut.isPending} onClick={() => linkMut.mutate()}>
              {linkMut.isPending ? "Linking…" : "Link and post to stock"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>


      <Dialog open={!!auditFor} onOpenChange={(v) => !v && setAuditFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Receipt audit trail</DialogTitle>
            <DialogDescription>Every action taken on this goods receipt.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-auto">
            {!auditRows?.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">No events recorded.</p>
            ) : auditRows.map((a: any) => (
              <div key={a.id} className="border-l-2 pl-3 py-1 text-xs">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[10px]">{a.action}</Badge>
                  <span className="text-muted-foreground">{format(new Date(a.created_at), "dd MMM yyyy HH:mm:ss")}</span>
                </div>
                <div className="text-muted-foreground mt-1">{a.actor_email || a.actor_user_id || "system"}</div>
                {a.payload && Object.keys(a.payload).length > 0 && (
                  <pre className="mt-1 bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-[11px]">
                    {JSON.stringify(a.payload, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


// ─── Store Issues Tab ───────────────────────────────────────────────
function StoreIssuesTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ conversion_id: "", material_id: "", quantity: "", notes: "" });

  const { data: issues, isLoading } = useQuery({
    queryKey: ["store-issues"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_issues")
        .select("*, materials(name, unit), container_conversions:conversion_id(conversion_number)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: conversions } = useQuery({
    queryKey: ["conversions-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("container_conversions").select("id, conversion_number").in("status", ["planning", "in_progress"]).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: materialsWithStock } = useQuery({
    queryKey: ["materials-with-stock"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materials").select("id, name, unit, material_stock(qty_available)").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const issueMut = useMutation({
    mutationFn: async () => {
      const qty = parseFloat(form.quantity);
      if (!qty || qty <= 0) throw new Error("Invalid quantity");
      // Check stock
      const mat = materialsWithStock?.find((m: any) => m.id === form.material_id) as any;
      const stock = Array.isArray(mat?.material_stock) ? mat.material_stock[0] : mat?.material_stock;
      const available = stock?.qty_available ?? 0;
      if (qty > available) throw new Error(`Insufficient stock. Available: ${available}`);

      const num = `ISS-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await supabase.from("store_issues").insert({
        issue_number: num,
        conversion_id: form.conversion_id,
        material_id: form.material_id,
        quantity: qty,
        issued_by: user?.id,
        notes: form.notes || null,
      } as any);
      if (error) throw error;
      // Stock is decremented by the database (material movement ledger)

    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store-issues"] });
      qc.invalidateQueries({ queryKey: ["materials-with-stock"] });
      qc.invalidateQueries({ queryKey: ["materials-catalog"] });
      toast({ title: "Material issued to job" });
      setOpen(false);
      setForm({ conversion_id: "", material_id: "", quantity: "", notes: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{issues?.length ?? 0} issues</p>
        <Button onClick={() => setOpen(true)} size="sm"><ArrowDownToLine className="mr-1 h-4 w-4" />Issue Material</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issue #</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Material</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !issues?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No store issues yet</TableCell></TableRow>
              ) : issues.map((iss: any) => (
                <TableRow key={iss.id}>
                  <TableCell className="font-mono text-xs">{iss.issue_number}</TableCell>
                  <TableCell className="font-mono text-sm">{iss.container_conversions?.conversion_number ?? "—"}</TableCell>
                  <TableCell className="font-medium">{iss.materials?.name ?? "—"} <span className="text-muted-foreground text-xs">({iss.materials?.unit})</span></TableCell>
                  <TableCell className="text-right font-mono">{Number(iss.quantity)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(iss.created_at), "dd MMM yyyy")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{iss.notes || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue Material to Job</DialogTitle>
            <DialogDescription>Issue materials from store stock to a conversion job.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); issueMut.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Conversion Job *</Label>
              <Select value={form.conversion_id} onValueChange={(v) => setForm((f) => ({ ...f, conversion_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select job" /></SelectTrigger>
                <SelectContent>{conversions?.map((c) => <SelectItem key={c.id} value={c.id}>{c.conversion_number}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Material *</Label>
              <Select value={form.material_id} onValueChange={(v) => setForm((f) => ({ ...f, material_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
                <SelectContent>
                  {materialsWithStock?.map((m: any) => {
                    const stock = Array.isArray(m.material_stock) ? m.material_stock[0] : m.material_stock;
                    const avail = stock?.qty_available ?? 0;
                    return <SelectItem key={m.id} value={m.id}>{m.name} — {avail} {m.unit} available</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Quantity *</Label><Input type="number" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
            <Button type="submit" className="w-full" disabled={issueMut.isPending || !form.conversion_id || !form.material_id || !form.quantity}>Issue Material</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Store Returns Tab ──────────────────────────────────────────────
function StoreReturnsTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ conversion_id: "", material_id: "", quantity: "", reason: "" });

  const { data: returns, isLoading } = useQuery({
    queryKey: ["store-returns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_returns")
        .select("*, materials(name, unit), container_conversions:conversion_id(conversion_number)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: conversions } = useQuery({
    queryKey: ["conversions-active"],
  });

  const { data: materials } = useQuery({
    queryKey: ["materials-active"],
  });

  const returnMut = useMutation({
    mutationFn: async () => {
      const qty = parseFloat(form.quantity);
      if (!qty || qty <= 0) throw new Error("Invalid quantity");
      const num = `RET-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await supabase.from("store_returns").insert({
        return_number: num,
        conversion_id: form.conversion_id || null,
        material_id: form.material_id,
        quantity: qty,
        returned_by: user?.id,
        reason: form.reason || null,
      } as any);
      if (error) throw error;
      // Stock is incremented by the database (material movement ledger)

    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store-returns"] });
      qc.invalidateQueries({ queryKey: ["materials-catalog"] });
      qc.invalidateQueries({ queryKey: ["materials-with-stock"] });
      toast({ title: "Material returned to store" });
      setOpen(false);
      setForm({ conversion_id: "", material_id: "", quantity: "", reason: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{returns?.length ?? 0} returns</p>
        <Button onClick={() => setOpen(true)} size="sm"><RotateCcw className="mr-1 h-4 w-4" />Return Material</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Return #</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Material</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !returns?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No store returns yet</TableCell></TableRow>
              ) : returns.map((ret: any) => (
                <TableRow key={ret.id}>
                  <TableCell className="font-mono text-xs">{ret.return_number}</TableCell>
                  <TableCell className="font-mono text-sm">{ret.container_conversions?.conversion_number ?? "—"}</TableCell>
                  <TableCell className="font-medium">{ret.materials?.name ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(ret.quantity)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(ret.created_at), "dd MMM yyyy")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{ret.reason || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return Material to Store</DialogTitle>
            <DialogDescription>Return unused materials from a conversion job back to store stock.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); returnMut.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label>From Job</Label>
              <Select value={form.conversion_id} onValueChange={(v) => setForm((f) => ({ ...f, conversion_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>{(conversions as any)?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.conversion_number}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Material *</Label>
              <Select value={form.material_id} onValueChange={(v) => setForm((f) => ({ ...f, material_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
                <SelectContent>{(materials as any)?.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Quantity *</Label><Input type="number" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Reason</Label><Textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Excess material, wrong spec…" /></div>
            <Button type="submit" className="w-full" disabled={returnMut.isPending || !form.material_id || !form.quantity}>Return to Store</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main Procurement Page ──────────────────────────────────────────
function UnpostedReceiptsBanner({ onGoToReceipts }: { onGoToReceipts: () => void }) {
  const { organizationId } = useOrganization();
  const { data: count = 0 } = useQuery({
    queryKey: ["unposted-receipt-lines", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goods_receipts")
        .select("id, is_void, goods_receipt_items(id, po_items(material_id))")
        .eq("organization_id", organizationId!)
        .eq("is_void", false);
      if (error) throw error;
      return (data as any[]).reduce(
        (n, r) => n + (r.goods_receipt_items ?? []).filter((gi: any) => !gi.po_items?.material_id).length,
        0,
      );
    },
  });

  if (!count) return null;
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
      <span className="text-warning">
        {count} received line{count > 1 ? "s" : ""} never reached inventory because no catalogue material is linked.
      </span>
      <Button size="sm" variant="outline" onClick={onGoToReceipts}>Review goods receipts</Button>
    </div>
  );
}

export default function PurchaseOrders() {
  const [tab, setTab] = useState("pos");
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShoppingBag className="h-6 w-6" />Procurement & Store</h1>
          <p className="text-muted-foreground">Purchase orders, goods receipts, store issues & returns</p>
        </div>
        <Button variant="outline" asChild>
          <a href="/materials"><Package className="mr-1 h-4 w-4" />Materials & Stock</a>
        </Button>
      </div>
      <UnpostedReceiptsBanner onGoToReceipts={() => setTab("receipts")} />
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="pos">Purchase Orders</TabsTrigger>
          <TabsTrigger value="receipts">Goods Receipts</TabsTrigger>
          <TabsTrigger value="issues">Store Issues</TabsTrigger>
          <TabsTrigger value="returns">Store Returns</TabsTrigger>
        </TabsList>
        <TabsContent value="pos"><PurchaseOrdersTab /></TabsContent>
        <TabsContent value="receipts"><GoodsReceiptsTab /></TabsContent>
        <TabsContent value="issues"><StoreIssuesTab /></TabsContent>
        <TabsContent value="returns"><StoreReturnsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

