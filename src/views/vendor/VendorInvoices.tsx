import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, Play, Eye, CheckCircle2, Send, Ban, Download } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const STATUS_VARIANTS: Record<string, any> = {
  draft: "secondary", sent: "default", paid: "default", overdue: "destructive", void: "outline",
};

function firstOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
function lastOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); }

export default function VendorInvoices() {
  const org = useOrganization();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [orgFilter, setOrgFilter] = useState<string>("all");
  const [running, setRunning] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["vendor-invoices", statusFilter, orgFilter],
    enabled: org.isPlatformAdmin,
    queryFn: async () => {
      let q = supabase
        .from("platform_invoices")
        .select("*, organizations(name)")
        .order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter as any);
      if (orgFilter !== "all") q = q.eq("organization_id", orgFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: orgs } = useQuery({
    queryKey: ["vendor-orgs-list"],
    enabled: org.isPlatformAdmin,
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("id, name").order("name");
      return data ?? [];
    },
  });

  if (org.loading) return <div className="p-6"><Loader2 className="animate-spin" /></div>;
  if (!org.isPlatformAdmin) return <Navigate to="/" replace />;

  const runBilling = async () => {
    if (!confirm(`Generate invoices for the current month (${firstOfMonth()} → ${lastOfMonth()})?`)) return;
    setRunning(true);
    const { data, error } = await supabase.rpc("generate_platform_invoices", {
      _period_start: firstOfMonth(),
      _period_end: lastOfMonth(),
    });
    setRunning(false);
    if (error) { toast.error(error.message); return; }
    const row: any = Array.isArray(data) ? data[0] : data;
    toast.success(`Generated ${row?.invoices_created ?? 0} invoice(s) — total ${Number(row?.total_amount ?? 0).toFixed(2)}`);
    qc.invalidateQueries({ queryKey: ["vendor-invoices"] });
  };

  const setStatus = async (id: string, status: "sent" | "paid" | "void") => {
    const patch: any = { status };
    if (status === "sent") patch.sent_at = new Date().toISOString();
    if (status === "paid") patch.paid_at = new Date().toISOString();
    const { error } = await supabase.from("platform_invoices").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Invoice marked ${status}`);
    qc.invalidateQueries({ queryKey: ["vendor-invoices"] });
  };

  const exportCSV = () => {
    if (!invoices?.length) return;
    const rows = [["Invoice #", "Organization", "Period", "Status", "Subtotal", "Total", "Currency", "Issued", "Due"]];
    invoices.forEach((i: any) => rows.push([
      i.invoice_number, i.organizations?.name ?? "", `${i.period_start} → ${i.period_end}`, i.status,
      i.subtotal, i.total, i.currency, i.issued_at?.slice(0, 10) ?? "", i.due_at?.slice(0, 10) ?? "",
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `platform-invoices-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const totals = (invoices ?? []).reduce((acc: any, i: any) => {
    acc[i.status] = (acc[i.status] ?? 0) + Number(i.total);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tenant Invoices</h1>
          <p className="text-sm text-muted-foreground">Subscription invoices for all depot tenants.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV} disabled={!invoices?.length}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
          <Button onClick={runBilling} disabled={running}>
            <Play className="h-4 w-4 mr-2" /> {running ? "Running..." : "Run billing now"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(["draft", "sent", "paid", "overdue"] as const).map((s) => (
          <Card key={s}>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground capitalize">{s}</p>
              <p className="text-lg font-semibold mt-1">{Number(totals[s] ?? 0).toFixed(2)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>{invoices?.length ?? 0} invoice(s)</CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={orgFilter} onValueChange={setOrgFilter}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Organization" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All organizations</SelectItem>
                  {orgs?.map((o: any) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="void">Void</SelectItem>
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
                <TableHead>Organization</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={8} />
              ) : !invoices?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No invoices yet. Click "Run billing now" to generate this month's invoices.</TableCell></TableRow>
              ) : invoices.map((i: any) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-xs">{i.invoice_number}</TableCell>
                  <TableCell>{i.organizations?.name}</TableCell>
                  <TableCell className="text-xs">{i.period_start} → {i.period_end}</TableCell>
                  <TableCell className="text-right font-mono">{i.currency} {Number(i.total).toFixed(2)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANTS[i.status] ?? "secondary"} className="capitalize">{i.status}</Badge></TableCell>
                  <TableCell className="text-xs">{i.issued_at ? format(new Date(i.issued_at), "PP") : "—"}</TableCell>
                  <TableCell className="text-xs">{i.due_at ? format(new Date(i.due_at), "PP") : "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" title="View" onClick={() => setDetailId(i.id)}><Eye className="h-4 w-4" /></Button>
                      {i.status === "draft" && <Button size="icon" variant="ghost" title="Mark sent" onClick={() => setStatus(i.id, "sent")}><Send className="h-4 w-4" /></Button>}
                      {(i.status === "sent" || i.status === "overdue" || i.status === "draft") && (
                        <Button size="icon" variant="ghost" title="Mark paid" onClick={() => setStatus(i.id, "paid")}><CheckCircle2 className="h-4 w-4" /></Button>
                      )}
                      {i.status !== "void" && i.status !== "paid" && (
                        <Button size="icon" variant="ghost" title="Void" onClick={() => setStatus(i.id, "void")}><Ban className="h-4 w-4" /></Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <InvoiceDetailDrawer invoiceId={detailId} onOpenChange={(o) => !o && setDetailId(null)} />
    </div>
  );
}

function InvoiceDetailDrawer({ invoiceId, onOpenChange }: { invoiceId: string | null; onOpenChange: (o: boolean) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["invoice-detail", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const [inv, lines] = await Promise.all([
        supabase.from("platform_invoices").select("*, organizations(name, billing_email, country, currency)").eq("id", invoiceId!).single(),
        supabase.from("platform_invoice_lines").select("*").eq("invoice_id", invoiceId!).order("created_at"),
      ]);
      return { invoice: inv.data as any, lines: (lines.data ?? []) as any[] };
    },
  });

  const inv = data?.invoice;

  return (
    <Sheet open={!!invoiceId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{inv?.invoice_number ?? "Invoice"}</SheetTitle>
          <SheetDescription>{inv?.organizations?.name}</SheetDescription>
        </SheetHeader>
        {isLoading || !inv ? (
          <div className="py-8 flex justify-center"><Loader2 className="animate-spin" /></div>
        ) : (
          <div className="mt-6 space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status" value={<Badge variant={STATUS_VARIANTS[inv.status] ?? "secondary"} className="capitalize">{inv.status}</Badge>} />
              <Field label="Currency" value={inv.currency} />
              <Field label="Period" value={`${inv.period_start} → ${inv.period_end}`} />
              <Field label="Issued" value={inv.issued_at ? format(new Date(inv.issued_at), "PP") : "—"} />
              <Field label="Due" value={inv.due_at ? format(new Date(inv.due_at), "PP") : "—"} />
              <Field label="Paid" value={inv.paid_at ? format(new Date(inv.paid_at), "PP") : "—"} />
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
                      <TableCell className="text-right font-mono">{Number(l.total).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3 flex justify-between font-semibold">
                <span>Total</span>
                <span>{inv.currency} {Number(inv.total).toFixed(2)}</span>
              </div>
            </div>
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
