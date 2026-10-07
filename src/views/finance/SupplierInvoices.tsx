import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ReceiptText, Printer, CheckCircle2, Ban, Eye, FileDown, RefreshCw, Pencil, FileCode2, AlertTriangle, Scale } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/finance-format";
import { formatMoneyCode } from "@/lib/money";
import { exportCSV } from "@/lib/export-utils";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { CurrencyOverrideDialog } from "@/components/finance/CurrencyOverrideDialog";
import { EditPurchaseInvoiceDialog } from "@/components/finance/EditPurchaseInvoiceDialog";


const STATUS_META: Record<string, { label: string; className: string }> = {
  issued:         { label: "Issued",          className: "bg-info/15 text-info" },
  partially_paid: { label: "Partially paid",  className: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  paid:           { label: "Paid",            className: "bg-success/15 text-success" },
  cancelled:      { label: "Cancelled",       className: "bg-muted text-muted-foreground line-through" },
};

const REASON_LABEL: Record<string, string> = {
  sale: "Sale",
  conversion: "Conversion",
  gate_out_sale: "Gate-out sale",
  manual: "Manual",
  purchase: "Purchase order",
};


type Row = any;

export default function SupplierInvoices() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [overrideFor, setOverrideFor] = useState<any>(null);
  const [editFor, setEditFor] = useState<any>(null);

  const { isOwnerOrAdmin } = useUserStaffRole();

  useEffect(() => {
    const id = searchParams.get("invoice");
    if (id) setDetailId(id);
  }, [searchParams]);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["supplier-invoices", statusFilter, reasonFilter],
    queryFn: async () => {
      let q = supabase
        .from("supplier_invoices" as any)
        .select("*, suppliers(name, email, phone, address), containers(container_number), edi_exports(id, status, payload, error, generated_at, downloaded_at)")
        .order("issue_date", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (reasonFilter !== "all") q = q.eq("reason", reasonFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows ?? [];
    return (rows ?? []).filter((r) =>
      [r.invoice_number, r.reference, r.suppliers?.name, r.containers?.container_number]
        .filter(Boolean).some((v: string) => String(v).toLowerCase().includes(s))
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    const acc: Record<string, number> = { issued: 0, partially_paid: 0, paid: 0, cancelled: 0 };
    (rows ?? []).forEach((r) => { acc[r.status] = (acc[r.status] ?? 0) + Number(r.total_amount ?? 0); });
    return acc;
  }, [rows]);

  const latestEdi = (r: any) => {
    const exports = ((r.edi_exports ?? []) as any[]).slice()
      .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());
    return exports[0] ?? null;
  };

  const downloadEdi = async (r: any) => {
    const latest = latestEdi(r);
    if (!latest?.payload) { toast.error("No EDI payload available"); return; }
    const blob = new Blob([latest.payload], { type: "application/EDIFACT" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${r.invoice_number}.edi`; a.click();
    URL.revokeObjectURL(url);
    await supabase.rpc("mark_edi_downloaded" as any, { _export_id: latest.id });
    qc.invalidateQueries({ queryKey: ["supplier-invoices"] });
  };

  const regenerateEdi = async (r: any) => {
    const { error } = await supabase.rpc("generate_supplier_invoice_edi" as any, { _invoice_id: r.id });
    if (error) { toast.error(error.message); return; }
    toast.success("EDI generated");
    qc.invalidateQueries({ queryKey: ["supplier-invoices"] });
  };

  const setStatus = async (id: string, status: "paid" | "cancelled") => {
    const patch: any = { status };
    if (status === "paid") {
      const inv = (rows ?? []).find((r) => r.id === id);
      patch.paid_amount = Number(inv?.total_amount ?? 0);
    }
    const { error } = await supabase.from("supplier_invoices" as any).update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Invoice marked ${status}`);
    qc.invalidateQueries({ queryKey: ["supplier-invoices"] });
  };

  const csvHeaders = ["Invoice #","Supplier ref","Supplier","Container","Reason","Issue","Due","Status","Currency","Total","Paid"];
  const csvRows = () => filtered.map((r) => [
    r.invoice_number,
    r.supplier_ref ?? "",
    r.suppliers?.name ?? "",
    r.containers?.container_number ?? "",
    REASON_LABEL[r.reason] ?? r.reason,
    r.issue_date,
    r.due_date,
    r.status,
    r.currency,
    Number(r.total_amount ?? 0).toFixed(2),
    Number(r.paid_amount ?? 0).toFixed(2),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ReceiptText className="h-6 w-6" /> Purchase Invoices
          </h1>
          <p className="text-sm text-muted-foreground">
            Vendor bills issued to container owners whenever the depot consumes their stock.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOwnerOrAdmin && (
            <Button asChild variant="outline">
              <Link to="/finance/supplier-statement">
                <Scale className="h-4 w-4 mr-2" /> Statement reconciliation
              </Link>
            </Button>
          )}
          {isOwnerOrAdmin && (
            <Button asChild variant="outline">
              <Link to="/finance/acquisition-duplicates">
                <AlertTriangle className="h-4 w-4 mr-2" /> Duplicate audit
              </Link>
            </Button>
          )}
          <Button variant="outline" disabled={!filtered.length}
            onClick={() => exportCSV("supplier_invoices.csv", csvHeaders, csvRows())}>
            <FileDown className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>




      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(["issued","partially_paid","paid","cancelled"] as const).map((s) => (
          <Card key={s}>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">{STATUS_META[s].label}</p>
              <p className="text-lg font-semibold mt-1 font-mono">{fmtMoney(totals[s] ?? 0)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>{filtered.length} invoice(s)</CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Input className="w-56" placeholder="Search invoice/supplier/container" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={reasonFilter} onValueChange={setReasonFilter}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Reason" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reasons</SelectItem>
                  <SelectItem value="sale">Sale</SelectItem>
                  <SelectItem value="conversion">Conversion</SelectItem>
                  <SelectItem value="gate_out_sale">Gate-out sale</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="issued">Issued</SelectItem>
                  <SelectItem value="partially_paid">Partially paid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Supplier ref</TableHead>
                <TableHead>Supplier (Owner)</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>

                <TableHead>Status</TableHead>
                <TableHead>EDI</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !filtered.length ? (
                <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">No purchase invoices yet.</TableCell></TableRow>
              ) : filtered.map((r) => (

                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                  <TableCell className="font-mono text-xs">{r.supplier_ref ?? "—"}</TableCell>
                  <TableCell>{r.suppliers?.name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.containers?.container_number ?? "—"}</TableCell>
                  <TableCell className="text-xs">{REASON_LABEL[r.reason] ?? r.reason}</TableCell>
                  <TableCell className="text-xs">{r.issue_date}</TableCell>
                  <TableCell className="text-xs">{r.due_date}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoneyCode(r.total_amount, r.currency)}</TableCell>
                  <TableCell className="text-right font-mono text-success">{formatMoneyCode(r.paid_amount ?? 0, r.currency)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoneyCode(Math.max(0, Number(r.total_amount ?? 0) - Number(r.paid_amount ?? 0)), r.currency)}</TableCell>

                  <TableCell>
                    <Badge className={STATUS_META[r.status]?.className ?? ""} variant="secondary">
                      {STATUS_META[r.status]?.label ?? r.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const latest = latestEdi(r);
                      const failed = latest?.status === "failed";
                      return (
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title={failed ? `EDI failed: ${latest?.error ?? ""}` : `EDI ${latest?.status ?? "not generated"}`}
                            disabled={!latest || failed}
                            onClick={() => downloadEdi(r)}
                          >
                            <FileCode2 className={`h-4 w-4 ${failed ? "text-destructive" : latest?.status === "downloaded" ? "text-success" : latest ? "" : "text-muted-foreground"}`} />
                          </Button>
                          {(!latest || failed) && (
                            <Button size="icon" variant="ghost" title="Generate EDI" onClick={() => regenerateEdi(r)}>
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" title="View" onClick={() => setDetailId(r.id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="Print" onClick={() => openPrint(r)}>
                        <Printer className="h-4 w-4" />
                      </Button>
                      {r.status !== "paid" && r.status !== "cancelled" && (
                        <Button size="icon" variant="ghost" title="Mark paid" onClick={() => setStatus(r.id, "paid")}>
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      )}
                      {r.status !== "cancelled" && r.status !== "paid" && (
                        <Button size="icon" variant="ghost" title="Cancel" onClick={() => setStatus(r.id, "cancelled")}>
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                      {isOwnerOrAdmin && r.status !== "cancelled" && (
                        <Button size="icon" variant="ghost" title="Edit invoice (admin, audited)" onClick={() => setEditFor(r)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {isOwnerOrAdmin && r.status !== "paid" && r.status !== "cancelled" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Override currency (admin, audited)"
                          onClick={() => setOverrideFor(r)}
                        >
                          <RefreshCw className="h-4 w-4" />
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

      <DetailDrawer invoiceId={detailId} onOpenChange={(o) => { if (!o) { setDetailId(null); if (searchParams.get("invoice")) { searchParams.delete("invoice"); setSearchParams(searchParams, { replace: true }); } } }} onPrint={openPrint} />

      {overrideFor && (
        <CurrencyOverrideDialog
          open={!!overrideFor}
          onOpenChange={(o) => !o && setOverrideFor(null)}
          kind="purchase"
          invoiceId={overrideFor.id}
          invoiceNumber={overrideFor.invoice_number}
          currentCurrency={overrideFor.currency}
          onSuccess={() => qc.invalidateQueries({ queryKey: ["supplier-invoices"] })}
        />
      )}

      {editFor && (
        <EditPurchaseInvoiceDialog
          open={!!editFor}
          onOpenChange={(o) => !o && setEditFor(null)}
          invoice={editFor}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["supplier-invoices"] });
            qc.invalidateQueries({ queryKey: ["supplier-invoice-detail"] });
          }}
        />
      )}

    </div>
  );
}

function DetailDrawer({
  invoiceId, onOpenChange, onPrint,
}: { invoiceId: string | null; onOpenChange: (o: boolean) => void; onPrint: (inv: any) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["supplier-invoice-detail", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const [inv, lines, allocs] = await Promise.all([
        supabase.from("supplier_invoices" as any)
          .select("*, suppliers(name,email,phone,address), containers(container_number), purchase_orders(po_number)")
          .eq("id", invoiceId!).single(),
        supabase.from("supplier_invoice_lines" as any).select("*").eq("invoice_id", invoiceId!).order("created_at"),
        supabase.from("vendor_payment_allocations" as any)
          .select("id, amount, method, created_at, vendor_payments(payment_number, payment_date, payment_method, currency)")
          .eq("supplier_invoice_id", invoiceId!).order("created_at"),
      ]);
      return { invoice: inv.data as any, lines: (lines.data ?? []) as any[], allocs: (allocs.data ?? []) as any[] };
    },

  });
  const inv = data?.invoice;
  return (
    <Sheet open={!!invoiceId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {inv?.invoice_number ?? "Purchase invoice"}
            {inv?.currency && (
              <Badge variant="outline" className="font-mono" title="Locked at creation. Admin override available.">
                {String(inv.currency).toUpperCase()}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>{inv?.suppliers?.name ?? ""}</SheetDescription>
        </SheetHeader>
        {isLoading || !inv ? (
          <div className="py-8 text-center text-muted-foreground">Loading…</div>
        ) : (
          <div className="mt-6 space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status" value={<Badge className={STATUS_META[inv.status]?.className} variant="secondary">{STATUS_META[inv.status]?.label}</Badge>} />
              <Field label="Currency" value={inv.currency} />
              <Field label="Reason" value={REASON_LABEL[inv.reason] ?? inv.reason} />
              <Field label="Reference" value={inv.reference ?? "—"} />
              <Field label="Issued" value={inv.issue_date} />
              <Field label="Due" value={inv.due_date} />
              <Field label="Container" value={inv.containers?.container_number ?? "—"} />
              <Field label="Linked PO" value={inv.purchase_orders?.po_number ?? "—"} />
            </div>
            <div>
              <p className="font-medium mb-2">Line items</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>{l.description}</TableCell>
                      <TableCell className="text-right">{Number(l.quantity)}</TableCell>
                      <TableCell className="text-right font-mono">{Number(l.unit_price).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">{Number(l.line_total).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3 flex justify-between items-baseline">
                <span className="font-semibold">Total ({String(inv.currency).toUpperCase()})</span>
                <span className="font-mono text-lg font-bold">{formatMoneyCode(inv.total_amount, inv.currency)}</span>
              </div>
              <p className="text-xs text-muted-foreground text-right">All amounts in {String(inv.currency).toUpperCase()}.</p>
            </div>

            <div>
              <p className="font-medium mb-2">Payments allocated</p>
              {!data!.allocs.length ? (
                <p className="text-xs text-muted-foreground">No payments allocated to this invoice yet.</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Payment #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>How</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data!.allocs.map((a: any) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-mono text-xs">{a.vendor_payments?.payment_number ?? "—"}</TableCell>
                          <TableCell className="text-xs">{a.vendor_payments?.payment_date ?? format(new Date(a.created_at), "yyyy-MM-dd")}</TableCell>
                          <TableCell className="text-xs">{a.method === "auto_fifo" ? "Auto (FIFO)" : a.method === "po_link" ? "Matched to PO" : (a.method ?? "Manual")}</TableCell>
                          <TableCell className="text-right font-mono">{formatMoneyCode(a.amount, inv.currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="mt-2 flex justify-between text-xs">
                    <span className="text-muted-foreground">Outstanding</span>
                    <span className="font-mono font-semibold">
                      {formatMoneyCode(Math.max(0, Number(inv.total_amount ?? 0) - Number(inv.paid_amount ?? 0)), inv.currency)}
                    </span>
                  </div>
                </>
              )}
            </div>

            <Button onClick={() => onPrint({ ...inv, lines: data!.lines })} className="w-full">
              <Printer className="h-4 w-4 mr-2" /> Print / Save PDF
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function openPrint(inv: any) {
  const lines = inv.lines ?? [{ description: inv.invoice_number, quantity: 1, unit_price: inv.total_amount, line_total: inv.total_amount }];
  const supplierName = inv.suppliers?.name ?? "Owner";
  const supplierAddr = inv.suppliers?.address ?? "";
  const supplierEmail = inv.suppliers?.email ?? "";
  const supplierPhone = inv.suppliers?.phone ?? "";
  const linesHtml = lines.map((l: any) => `
    <tr>
      <td>${escapeHtml(l.description ?? "")}</td>
      <td style="text-align:right">${Number(l.quantity ?? 0)}</td>
      <td style="text-align:right">${Number(l.unit_price ?? 0).toFixed(2)}</td>
      <td style="text-align:right">${Number(l.line_total ?? 0).toFixed(2)}</td>
    </tr>`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${inv.invoice_number}</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; color:#111; padding: 32px; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .meta { color:#666; font-size: 12px; }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
    .box { border:1px solid #e5e5e5; border-radius: 6px; padding: 12px; }
    table { width:100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom:1px solid #eee; padding: 8px; text-align:left; }
    .totals { margin-top: 16px; text-align:right; font-size: 14px; }
    .totals .grand { font-size: 18px; font-weight: 700; margin-top: 6px; }
  </style></head><body>
    <h1>Purchase Invoice <span style="background:#111;color:#fff;padding:2px 8px;border-radius:4px;font-family:monospace;font-size:14px;vertical-align:middle;">${String(inv.currency ?? "").toUpperCase()}</span></h1>
    <div class="meta">${inv.invoice_number} · Issued ${inv.issue_date} · Due ${inv.due_date}</div>
    <div class="grid">
      <div class="box">
        <div class="meta">Bill to (Owner)</div>
        <div><strong>${escapeHtml(supplierName)}</strong></div>
        <div>${escapeHtml(supplierAddr)}</div>
        <div>${escapeHtml(supplierEmail)} ${supplierPhone ? "· " + escapeHtml(supplierPhone) : ""}</div>
      </div>
      <div class="box">
        <div class="meta">Reference</div>
        <div>${escapeHtml(inv.reference ?? "—")}</div>
        <div class="meta" style="margin-top:8px">Reason</div>
        <div>${escapeHtml(REASON_LABEL[inv.reason] ?? inv.reason)}</div>
        ${inv.containers?.container_number ? `<div class="meta" style="margin-top:8px">Container</div><div>${escapeHtml(inv.containers.container_number)}</div>` : ""}
      </div>
    </div>
    <table>
      <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${linesHtml}</tbody>
    </table>
    <div class="totals">
      <div>Subtotal: <span style="font-family:monospace">${String(inv.currency ?? "").toUpperCase()} ${Number(inv.subtotal ?? inv.total_amount ?? 0).toFixed(2)}</span></div>
      <div>Tax: <span style="font-family:monospace">${String(inv.currency ?? "").toUpperCase()} ${Number(inv.tax_amount ?? 0).toFixed(2)}</span></div>
      <div class="grand">TOTAL — ${String(inv.currency ?? "").toUpperCase()} ${Number(inv.total_amount ?? 0).toFixed(2)}</div>
      <div style="font-size:11px;color:#666;margin-top:4px;">All amounts in ${String(inv.currency ?? "").toUpperCase()}.</div>
    </div>
  </body></html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 250);
}

function escapeHtml(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
}
