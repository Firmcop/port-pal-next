import { useState, useEffect } from "react";
import { getDefaultCurrency } from "@/lib/finance-format";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useContainerAcquisition } from "@/hooks/use-container-acquisition";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, ShoppingCart, MoreHorizontal, Printer, FileText, ReceiptText, Pencil } from "lucide-react";
import { Link } from "@/lib/router";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { printSaleReceipt } from "@/lib/document-templates";
import { getPrintDepot } from "@/lib/app-settings";
import { generateEirPrint } from "@/lib/eir-templates";
import { acquireContainerFromOwner } from "@/lib/container-acquisition";
import { deriveMarkup, setSalePricing } from "@/lib/container-sale-pricing";

import { CurrencySelect } from "@/components/CurrencySelect";
import { useOrgCurrency } from "@/hooks/use-org-currency";
import { useOrganization } from "@/hooks/use-organization";
import { getFxRate } from "@/lib/fx";
import { PoRecipientPreview, sourceLabel, sourceBadgeClass } from "@/components/finance/PoRecipientPreview";

const statusColor: Record<string, string> = {
  listed: "bg-info/15 text-info",
  reserved: "bg-warning/15 text-warning",
  sold: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
};

export default function ContainerSales() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const quoteFilter = urlParams.get("quote");
  const highlightId = urlParams.get("highlight");

  const { data: sales, isLoading } = useQuery({
    queryKey: ["container-sales", quoteFilter],
    queryFn: async () => {
      let q = supabase
        .from("container_sales")
        .select("*, containers(container_number, size, category, owner, shipping_line, iso_type, tare_weight_kg, weight_kg, is_empty, status), quotes:quote_id(id, quote_number), purchase_invoice:purchase_invoice_id(id, po_number, recipient_source, recipient_resolution_note, suppliers(name))")
        .order("created_at", { ascending: false });
      if (quoteFilter) q = q.eq("quote_id", quoteFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });


  const { data: containers } = useQuery({
    queryKey: ["sellable-containers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("containers")
        .select("id, container_number, size, category, owner, shipping_line")
        .in("status", ["available", "allocated"])
        .order("container_number");
      if (error) throw error;
      return data;
    },
  });

  const { data: buyers } = useQuery({
    queryKey: ["buyer-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, company_name, contact_person, phone, currency")
        .eq("customer_type", "buyer")
        .eq("is_active", true)
        .order("company_name");
      if (error) throw error;
      return data;
    },
  });

  // Branding follows the header working-depot picker; falls back to org.
  const depot = getPrintDepot();


  const { currency: orgCurrency } = useOrgCurrency();
  const { organizationId } = useOrganization();
  const [open, setOpen] = useState(false);
  const [editSale, setEditSale] = useState<any | null>(null);
  const defaultCurrency = orgCurrency ?? getDefaultCurrency();
  const [form, setForm] = useState({ container_id: "", buyer_id: "", buyer_name: "", buyer_contact: "", currency: "", selling_price: "", notes: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    if (!form.currency && defaultCurrency) setForm((f) => ({ ...f, currency: defaultCurrency }));
  }, [defaultCurrency, form.currency]);

  // Entry price is locked to the container: the full acquisition cost from its live invoices.
  const { data: acq } = useContainerAcquisition(form.container_id || null);
  const entryPrice = Number(acq?.total ?? 0);
  const sellingPrice = parseFloat(form.selling_price) || 0;
  const markup = deriveMarkup(entryPrice, sellingPrice);


  const createMut = useMutation({
    mutationFn: async () => {
      const num = `SLE-${Date.now().toString(36).toUpperCase()}`;
      const selectedContainer = containers?.find((c) => c.id === form.container_id);
      const { error } = await supabase.from("container_sales").insert({
        sale_number: num,
        container_id: form.container_id,
        customer_id: form.buyer_id || null,
        buyer_name: form.buyer_name,
        buyer_contact: form.buyer_contact,
        entry_price: entryPrice,
        currency: form.currency || defaultCurrency,
        transport_offloading_cost: 0,
        markup_percentage: markup,
        selling_price: sellingPrice,

        notes: form.notes,
        created_by: user?.id,
        original_owner: selectedContainer?.owner || selectedContainer?.shipping_line || null,
        acquisition_supplier: selectedContainer?.owner || selectedContainer?.shipping_line || null,

      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["container-sales"] });
      qc.invalidateQueries({ queryKey: ["sellable-containers"] });
      toast({ title: "Container listed for sale" });
      setOpen(false);
      setForm({ container_id: "", buyer_id: "", buyer_name: "", buyer_contact: "", currency: defaultCurrency, selling_price: "", notes: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });


  const markSold = useMutation({
    mutationFn: async (id: string) => {
      const sale = sales?.find((s: any) => s.id === id);
      if (!sale) throw new Error("Sale not found");
      if (sale.status === "sold") throw new Error("This sale is already completed — no further invoices will be raised.");



      // depot custodianship is implicit via status; never written into containers.owner
      // Acquisition vendor = who we bought the box from (drives the purchase invoice/PO).
      const originalOwner = (sale as any).acquisition_supplier || (sale as any).original_owner || sale.containers?.owner || sale.containers?.shipping_line || "Unknown";
      const currency = (sale as any).currency || orgCurrency || getDefaultCurrency();

      const orgBase = orgCurrency || getDefaultCurrency();
      let fxRate = 1;
      try {
        fxRate = organizationId ? await getFxRate(organizationId, currency, orgBase, new Date()) : 1;
      } catch (e: any) {
        throw new Error(e?.message || `Missing FX rate ${currency} → ${orgBase}. Add it under Finance → FX Rates.`);
      }

      // 1. Acquisition PO payable to the registered/shipping-line owner FIRST,
      //    while containers.owner still holds the true owner. We also pass it
      //    explicitly so the RPC is order-independent.
      const poId = await acquireContainerFromOwner({
        containerId: sale.container_id,
        amount: Number(sale.entry_price) || 0,
        currency,
        reason: "sale",
        reference: sale.sale_number,
        expectedOwner: originalOwner,
      });

      // 2. Gate-out movement + EIR
      if (sale.container_id) {
        await supabase.from("container_movements").insert({
          container_id: sale.container_id,
          movement_type: "gate_out" as any,
          notes: `Container sold — ${sale.sale_number} to ${sale.buyer_name}`,
          performed_by: user?.id,
        });
      }

      const { data: saleEirNum } = await supabase.rpc("next_eir_number" as any, { prefix: "EIR-SLE" });
      const { data: eirData } = await supabase.from("eir_records").insert({
        eir_number: (saleEirNum as unknown as string) ?? `EIR-SLE-${Date.now().toString(36).toUpperCase()}`,
        eir_type: "gate_out" as any,
        container_id: sale.container_id,
        condition_grade: "A" as any,
        release_purpose: "sale",
        inspector_notes: `Sale ${sale.sale_number} to ${sale.buyer_name}`,
        completed_at: new Date().toISOString(),
      }).select("id").single();

      // 3. Transfer ownership to the BUYER (never the depot) and mark sold
      if (sale.container_id) {
        await supabase.from("containers").update({
          owner: sale.buyer_name,
          status: "sold" as any,
          gate_out_at: new Date().toISOString(),
        }).eq("id", sale.container_id);
      }

      // 4. Accounting: cost of sale only. Stock is relieved automatically by the
      //    ledger contra rule, and the sale income is carried by the customer
      //    invoice so it is never counted twice.
      const txnBase = Date.now().toString(36).toUpperCase();
      const cogsAmount = Number(sale.entry_price || 0) + Number((sale as any).transport_offloading_cost || 0);
      await supabase.from("accounting_transactions").insert([
        {
          transaction_number: `TXN-COGS-${txnBase}`,
          account_type: "expense" as any,
          category: "container_sale_cogs",
          description: `COGS — acquisition of ${sale.containers?.container_number ?? ""} from ${originalOwner}`,
          debit_amount: cogsAmount,
          credit_amount: 0,
          reference_type: "container_sales",
          reference_id: id,
          created_by: user?.id,
          currency,
          fx_rate: fxRate,
          base_currency: orgBase,
        },
      ]);


      // 5. Update sale record. Documents (EIR/receipt) show the depot as outgoing
      //    owner once a purchase invoice exists; the acquisition vendor stays on file.
      let documentOwner = originalOwner;
      if (sale.container_id) {
        const { data: docOwner } = await supabase.rpc("container_document_owner" as any, {
          _container_id: sale.container_id,
        });
        if (docOwner && String(docOwner).trim()) documentOwner = String(docOwner).trim();
      }
      const { error } = await supabase.from("container_sales").update({
        status: "sold" as any,
        sold_at: new Date().toISOString(),
        eir_id: eirData?.id ?? null,
        original_owner: documentOwner,
        acquisition_supplier: originalOwner,
        purchase_invoice_id: (poId as unknown as string) ?? null,
      } as any).eq("id", id);

      if (error) throw error;
      return { acquired: !!poId, owner: originalOwner };
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["container-sales"] });
      qc.invalidateQueries({ queryKey: ["sellable-containers"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["accounting-transactions"] });
      toast({ title: res?.acquired ? `Sold — purchase invoice issued to ${res.owner}` : "Container marked as sold" });
      if (!res?.acquired) {
        toast({
          title: "No purchase invoice issued",
          description: "Entry price is 0 or the container is depot-owned. Set an entry price to bill the owner.",
        });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handlePrintEir = async (sale: any) => {
    if (!sale.eir_id) {
      toast({ title: "No EIR", description: "No EIR record linked to this sale", variant: "destructive" });
      return;
    }
    const { data: eir } = await supabase.from("eir_records").select("*").eq("id", sale.eir_id).single();
    if (!eir) return;
    const container = sale.containers ? {
      container_number: sale.containers.container_number,
      size: sale.containers.size,
      iso_type: sale.containers.iso_type,
      category: sale.containers.category,
      owner: sale.original_owner ?? sale.containers?.owner ?? null,
      shipping_line: sale.containers.shipping_line,
      tare_weight_kg: sale.containers.tare_weight_kg,
      weight_kg: sale.containers.weight_kg,
      is_empty: sale.containers.is_empty,
    } : null;
    await generateEirPrint({
      ...eir,
      photos: Array.isArray(eir.photos) ? eir.photos as string[] : [],
      container,
      depot: depot ? { name: depot.name, code: depot.code, location: depot.location, logo_url: depot.logo_url } : null,
      buyer: {
        label: "Buyer",
        name: sale.buyer_name,
        contact: sale.buyer_contact,
        original_owner: sale.original_owner ?? sale.containers?.owner ?? null,
      },
    });
  };

  const handlePrintReceipt = async (sale: any) => {
    await printSaleReceipt({
      sale_number: sale.sale_number,
      container_number: sale.containers?.container_number ?? "—",
      container_size: sale.containers?.size,
      container_category: sale.containers?.category,
      buyer_name: sale.buyer_name,
      buyer_contact: sale.buyer_contact,
      original_owner: sale.original_owner,
      entry_price: sale.entry_price,
      markup_percentage: sale.markup_percentage,
      selling_price: sale.selling_price,
      sold_at: sale.sold_at ?? sale.created_at,
      notes: sale.notes,
      currency: sale.currency || orgCurrency,
      depot: depot ? { name: depot.name, location: depot.location, logo_url: depot.logo_url } : null,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShoppingCart className="h-6 w-6" />Container Sales</h1>
          <p className="text-muted-foreground">Sell shipping containers with entry pricing and markup</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />List for Sale</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>List Container for Sale</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Container</Label>
                <Select value={form.container_id} onValueChange={(v) => set("container_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
                  <SelectContent>{containers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.container_number} ({c.size}' {c.category}) — Owner: {c.owner || c.shipping_line || "N/A"}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Buyer (from registry)</Label>
                <Select value={form.buyer_id} onValueChange={(v) => {
                  const buyer = buyers?.find((b) => b.id === v);
                  setForm((f) => ({
                    ...f,
                    buyer_id: v,
                    buyer_name: buyer?.company_name ?? "",
                    buyer_contact: buyer?.phone ?? "",
                    // Prefer the buyer's registered currency so invoices land in the right ccy.
                    currency: (buyer as any)?.currency || f.currency || defaultCurrency,
                  }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Select buyer" /></SelectTrigger>
                  <SelectContent>{buyers?.map((b) => <SelectItem key={b.id} value={b.id}>{b.company_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Buyer Name</Label><Input value={form.buyer_name} onChange={(e) => set("buyer_name", e.target.value)} required /></div>
                <div className="space-y-2"><Label>Contact</Label><Input value={form.buyer_contact} onChange={(e) => set("buyer_contact", e.target.value)} /></div>
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <CurrencySelect value={form.currency} onChange={(v) => set("currency", v)} />
                <p className="text-xs text-muted-foreground">Used for entry/selling prices, accounting entries, and the buyer receipt.</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Entry Price ({form.currency || defaultCurrency})</Label>
                  <Input value={entryPrice.toFixed(2)} readOnly className="bg-muted" />
                </div>
                <div className="space-y-2">
                  <Label>Selling Price</Label>
                  <Input type="number" step="0.01" min="0" value={form.selling_price} onChange={(e) => set("selling_price", e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Markup %</Label>
                  <Input value={markup.toFixed(2)} readOnly className="bg-muted" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Entry price is the container's full acquisition cost (seller + transport + crane), fetched from its purchase invoices
                {acq?.empty ? " — none recorded yet" : ""}
                {form.container_id ? <> · <a className="underline" href={`/inventory/${form.container_id}`}>edit on the container</a></> : null}.
                Markup is calculated from the selling price you enter.
              </p>

              {form.container_id && (
                <PoRecipientPreview
                  containerId={form.container_id}
                  expectedOwner={containers?.find((c) => c.id === form.container_id)?.owner ?? containers?.find((c) => c.id === form.container_id)?.shipping_line ?? null}
                />
              )}
              <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
              <Button type="submit" className="w-full" disabled={createMut.isPending || !form.container_id || !form.buyer_name}>List for Sale</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sale #</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Original Owner</TableHead>
                <TableHead>PO Issued To</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Markup</TableHead>
                <TableHead>Selling</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !sales?.length ? (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No sales records yet</TableCell></TableRow>
              ) : sales.map((s: any) => (
                <TableRow key={s.id} className={highlightId === s.id ? "bg-primary/10" : undefined}>
                  <TableCell className="font-mono text-xs">
                    {s.sale_number}
                    {s.quotes?.quote_number && (
                      <Link to={`/quotes/${s.quotes.id}`} className="ml-2">
                        <Badge variant="outline" className="text-[10px]">from {s.quotes.quote_number}</Badge>
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{s.containers?.container_number ?? "—"}</TableCell>
                  <TableCell>{s.buyer_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.original_owner ?? s.containers?.owner ?? "—"}</TableCell>
                  <TableCell>
                    {s.purchase_invoice?.suppliers?.name ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium">{s.purchase_invoice.suppliers.name}</span>
                        <Badge
                          variant="secondary"
                          className={`w-fit text-[10px] ${sourceBadgeClass(s.purchase_invoice.recipient_source)}`}
                          title={s.purchase_invoice.recipient_resolution_note ?? undefined}
                        >
                          {sourceLabel(s.purchase_invoice.recipient_source)}
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{s.currency ?? ""} {Number(s.entry_price).toLocaleString()}</TableCell>
                  <TableCell>{s.markup_percentage}%</TableCell>
                  <TableCell className="font-semibold font-mono text-sm">{s.currency ?? ""} {Number(s.selling_price).toLocaleString()}</TableCell>
                  <TableCell><Badge className={statusColor[s.status] ?? ""} variant="secondary">{s.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(s.created_at), "dd MMM yyyy")}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {s.status === "listed" && (
                          <DropdownMenuItem onClick={() => markSold.mutate(s.id)}>
                            Mark Sold
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setEditSale(s)}>
                          <Pencil className="mr-2 h-4 w-4" />Edit Pricing
                        </DropdownMenuItem>
                        {s.status === "sold" && (
                          <>
                            <DropdownMenuItem onClick={() => handlePrintEir(s)}>
                              <Printer className="mr-2 h-4 w-4" />Print EIR
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handlePrintReceipt(s)}>
                              <FileText className="mr-2 h-4 w-4" />Print Sale Receipt
                            </DropdownMenuItem>
                            {s.supplier_invoice_id && (
                              <DropdownMenuItem asChild>
                                <Link to={`/finance/supplier-invoices?invoice=${s.supplier_invoice_id}`}>
                                  <ReceiptText className="mr-2 h-4 w-4" />View Purchase Invoice
                                </Link>
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <EditSaleCostsDialog sale={editSale} onOpenChange={(o) => !o && setEditSale(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["container-sales"] })} />
    </div>
  );
}

function EditSaleCostsDialog({ sale, onOpenChange, onSaved }: { sale: any | null; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [selling, setSelling] = useState("");
  const [reason, setReason] = useState("");
  const key = sale?.id ?? "";
  useEffect(() => {
    if (sale) {
      setSelling(String(sale.selling_price ?? ""));
      setReason("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Live acquisition cost — the entry price is never typed, it is fetched.
  const { data: acq } = useContainerAcquisition(sale?.container_id ?? null);
  const entry = Number(acq?.total ?? sale?.entry_price ?? 0);
  const sellingNum = parseFloat(selling) || 0;
  const markup = deriveMarkup(entry, sellingNum);

  const mut = useMutation({
    mutationFn: () => setSalePricing(sale.id, sellingNum, reason),
    onSuccess: (res) => {
      const parts: string[] = [];
      if (res?.ledger_posted) parts.push("ledger adjusted");
      if (res?.invoice_updated) parts.push("customer invoice updated");
      toast({ title: "Pricing updated", description: parts.join(" · ") || "Saved" });
      onSaved();
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const ccy = sale?.currency ?? acq?.currency ?? "";

  return (
    <Dialog open={!!sale} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Pricing — {sale?.sale_number}</DialogTitle>
          <DialogDescription>
            Entry price is refreshed from the container's acquisition invoices (seller + transport + crane). Enter the selling price; markup is calculated.
            {sale?.status === "sold" ? " COGS, revenue and the customer invoice are restated automatically." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Entry Price ({ccy})</Label>
              <Input value={entry.toFixed(2)} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>Selling Price</Label>
              <Input type="number" step="0.01" min="0" value={selling} onChange={(e) => setSelling(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Markup %</Label>
              <Input value={markup.toFixed(2)} readOnly className="bg-muted" />
            </div>
          </div>
          {acq?.empty && (
            <p className="text-xs text-warning">No acquisition invoice recorded for this container yet — entry price will be zero.</p>
          )}
          <p className="text-xs text-muted-foreground">
            To change the entry price, edit the acquisition cost
            {sale?.container_id ? <> · <a className="underline" href={`/inventory/${sale.container_id}`}>open the container</a></> : null}.
          </p>
          <div className="space-y-2">
            <Label>Reason *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the price changing?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !reason.trim() || !selling}>
            {mut.isPending ? "Saving…" : "Save pricing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

