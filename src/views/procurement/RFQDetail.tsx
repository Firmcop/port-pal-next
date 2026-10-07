import { useMemo, useState } from "react";
import { useNavigate, useParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ArrowLeft, Send, X, Plus, Check, Mail, RefreshCw, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import RFQComparison from "@/components/procurement/RFQComparison";
import AwardReviewDialog from "@/components/procurement/AwardReviewDialog";
import RFQAttachments from "@/components/procurement/RFQAttachments";

const STATUS_VARIANTS: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
  invited: "outline",
  accepted: "default",
  declined: "destructive",
  responded: "default",
  no_response: "secondary",
};

export default function RFQDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [quoteFor, setQuoteFor] = useState<string | null>(null); // rfq_supplier_id
  const [prices, setPrices] = useState<Record<string, { unit_price: number; lead_time_days?: number | null; notes?: string }>>({});
  const [addSupplierId, setAddSupplierId] = useState<string>("");
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [awardFor, setAwardFor] = useState<string | null>(null);

  const { data: rfq, isLoading } = useQuery({
    queryKey: ["rfq", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("rfqs").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: items } = useQuery({
    queryKey: ["rfq-items", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("rfq_items").select("*").eq("rfq_id", id!).order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!id,
  });

  const { data: rfqSuppliers } = useQuery({
    queryKey: ["rfq-suppliers", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rfq_suppliers")
        .select("*, suppliers(id, name, email)")
        .eq("rfq_id", id!)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!id,
  });

  const { data: quotes } = useQuery({
    queryKey: ["rfq-quotes", id],
    queryFn: async () => {
      const supIds = (rfqSuppliers ?? []).map((s: any) => s.id);
      if (!supIds.length) return [];
      const { data, error } = await supabase
        .from("rfq_supplier_quotes")
        .select("*")
        .in("rfq_supplier_id", supIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!rfqSuppliers?.length,
  });

  const { data: availableSuppliers } = useQuery({
    queryKey: ["rfq-avail-suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const priceMap = useMemo(() => {
    const m: Record<string, Record<string, any>> = {};
    (quotes ?? []).forEach((q: any) => { (m[q.rfq_supplier_id] ??= {})[q.rfq_item_id] = q; });
    return m;
  }, [quotes]);

  const totalsBySupplier = useMemo(() => {
    const totals: Record<string, number> = {};
    (rfqSuppliers ?? []).forEach((rs: any) => {
      let sum = 0;
      (items ?? []).forEach((it: any) => {
        const q = priceMap[rs.id]?.[it.id];
        if (q) sum += Number(q.unit_price ?? 0) * Number(it.quantity ?? 0);
      });
      totals[rs.id] = sum;
    });
    return totals;
  }, [rfqSuppliers, items, priceMap]);

  const updateStatusMut = useMutation({
    mutationFn: async (newStatus: string) => {
      const { error } = await supabase.from("rfqs").update({ status: newStatus }).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rfq", id] }); toast({ title: "Status updated" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const markSentMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("rfq_suppliers")
        .update({ status: "invited", sent_at: new Date().toISOString(), invited_at: new Date().toISOString() })
        .eq("rfq_id", id!).eq("status", "invited");
      if (error) throw error;
      await supabase.from("rfqs").update({ status: "sent" }).eq("id", id!);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfq", id] });
      qc.invalidateQueries({ queryKey: ["rfq-suppliers", id] });
      toast({ title: "RFQ marked as sent" });
    },
  });

  const addSupplierMut = useMutation({
    mutationFn: async () => {
      if (!addSupplierId) throw new Error("Pick a supplier");
      const { error } = await supabase.from("rfq_suppliers").insert({
        rfq_id: id!, supplier_id: addSupplierId, status: "invited", invited_at: new Date().toISOString(),
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rfq-suppliers", id] }); setAddSupplierId(""); toast({ title: "Supplier invited" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const removeSupplierMut = useMutation({
    mutationFn: async (rsId: string) => {
      const { error } = await supabase.from("rfq_suppliers").delete().eq("id", rsId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rfq-suppliers", id] }); qc.invalidateQueries({ queryKey: ["rfq-quotes", id] }); },
  });

  const markStatusMut = useMutation({
    mutationFn: async ({ rsId, status, reason }: { rsId: string; status: string; reason?: string }) => {
      const { error } = await supabase.rpc("mark_supplier_invitation", { _rfq_supplier_id: rsId, _status: status, _reason: reason ?? null });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfq-suppliers", id] });
      toast({ title: "Invitation updated" });
      setDeclineFor(null); setDeclineReason("");
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const resendMut = useMutation({
    mutationFn: async (rsId: string) => {
      const { error } = await supabase.rpc("resend_supplier_invitation", { _rfq_supplier_id: rsId, _channel: "manual" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rfq-suppliers", id] }); toast({ title: "Reminder logged" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const openQuoteEditor = (rsId: string) => {
    const existing = priceMap[rsId] ?? {};
    const prefill: any = {};
    (items ?? []).forEach((it: any) => {
      const q = existing[it.id];
      prefill[it.id] = {
        unit_price: q ? Number(q.unit_price) : 0,
        lead_time_days: q?.lead_time_days ?? null,
        notes: q?.notes ?? "",
      };
    });
    setPrices(prefill);
    setQuoteFor(rsId);
  };

  const saveQuoteMut = useMutation({
    mutationFn: async () => {
      if (!quoteFor) return;
      const payload = Object.entries(prices).map(([rfq_item_id, v]) => ({
        rfq_item_id,
        unit_price: v.unit_price,
        lead_time_days: v.lead_time_days ?? null,
        notes: v.notes ?? null,
      }));
      const { error } = await supabase.rpc("record_supplier_quote", { _rfq_supplier_id: quoteFor, _quotes: payload as any });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Quote saved" });
      qc.invalidateQueries({ queryKey: ["rfq-quotes", id] });
      qc.invalidateQueries({ queryKey: ["rfq-suppliers", id] });
      setQuoteFor(null);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !rfq) return <div className="p-6">Loading…</div>;

  const isFinal = rfq.status === "awarded" || rfq.status === "cancelled";
  const awardTarget = (rfqSuppliers ?? []).find((rs: any) => rs.supplier_id === awardFor);
  const awardQuotes = awardTarget ? (quotes ?? []).filter((q: any) => q.rfq_supplier_id === awardTarget.id) : [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav("/procurement/rfqs")}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{rfq.rfq_number} · {rfq.title}</h1>
          <div className="text-sm text-muted-foreground flex gap-3 items-center">
            <Badge>{rfq.status}</Badge>
            {rfq.response_deadline && <span>Deadline: {format(new Date(rfq.response_deadline), "PP")}</span>}
            <span>Currency: {rfq.currency ?? "—"}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {rfq.status === "draft" && (
            <Button variant="outline" onClick={() => markSentMut.mutate()}><Send className="h-4 w-4 me-2" />Mark sent</Button>
          )}
          {rfq.status === "sent" && (
            <Button variant="outline" onClick={() => updateStatusMut.mutate("closed")}>Close for quotes</Button>
          )}
          {!isFinal && (
            <Button variant="outline" onClick={() => updateStatusMut.mutate("cancelled")}><X className="h-4 w-4 me-2" />Cancel</Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Items & specifications</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Specification / Part #</TableHead>
                <TableHead className="w-28 text-right">Qty</TableHead>
                <TableHead className="w-20">UoM</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(items ?? []).map((it: any) => (
                <TableRow key={it.id}>
                  <TableCell>{it.description}</TableCell>
                  <TableCell className="text-sm">
                    {it.part_number && <div className="font-mono text-xs">P/N: {it.part_number}</div>}
                    {it.specification && <div className="text-muted-foreground whitespace-pre-wrap">{it.specification}</div>}
                    {!it.specification && !it.part_number && <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">{Number(it.quantity)}</TableCell>
                  <TableCell>{it.uom ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Suppliers & invitations</span>
            {!isFinal && (
              <div className="flex gap-2">
                <Select value={addSupplierId || undefined} onValueChange={setAddSupplierId}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="Add supplier..." /></SelectTrigger>
                  <SelectContent>
                    {(availableSuppliers ?? [])
                      .filter((s) => !(rfqSuppliers ?? []).some((rs: any) => rs.supplier_id === s.id))
                      .map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={() => addSupplierMut.mutate()} disabled={!addSupplierId}><Plus className="h-4 w-4 me-1" />Invite</Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invited</TableHead>
                <TableHead>Responded</TableHead>
                <TableHead className="text-right">Total quoted</TableHead>
                <TableHead className="w-80 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rfqSuppliers ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No suppliers invited.</TableCell></TableRow>
              ) : (
                (rfqSuppliers ?? []).map((rs: any) => (
                  <TableRow key={rs.id}>
                    <TableCell>
                      <div className="font-medium">{rs.suppliers?.name}</div>
                      {rs.suppliers?.email && <div className="text-xs text-muted-foreground">{rs.suppliers.email}</div>}
                      {rs.decline_reason && <div className="text-xs text-destructive mt-1">Reason: {rs.decline_reason}</div>}
                    </TableCell>
                    <TableCell><Badge variant={STATUS_VARIANTS[rs.status] ?? "outline"}>{rs.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {rs.invited_at ? formatDistanceToNow(new Date(rs.invited_at), { addSuffix: true }) : "—"}
                      {rs.last_reminder_at && <div>Reminded {formatDistanceToNow(new Date(rs.last_reminder_at), { addSuffix: true })}</div>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {rs.responded_at ? formatDistanceToNow(new Date(rs.responded_at), { addSuffix: true }) : "—"}
                    </TableCell>
                    <TableCell className="text-right">{totalsBySupplier[rs.id] ? totalsBySupplier[rs.id].toFixed(2) : "—"}</TableCell>
                    <TableCell className="text-right space-x-1">
                      {!isFinal && rs.status === "invited" && (
                        <>
                          <Button size="sm" variant="ghost" title="Mark accepted" onClick={() => markStatusMut.mutate({ rsId: rs.id, status: "accepted" })}><Check className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" title="Mark declined" onClick={() => { setDeclineFor(rs.id); setDeclineReason(""); }}><XCircle className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" title="Resend" onClick={() => resendMut.mutate(rs.id)}><RefreshCw className="h-4 w-4" /></Button>
                        </>
                      )}
                      {!isFinal && rs.status === "invited" && rs.invited_at &&
                        (Date.now() - new Date(rs.invited_at).getTime() > 3 * 86400000) && (
                          <Button size="sm" variant="ghost" title="No response"
                            onClick={() => markStatusMut.mutate({ rsId: rs.id, status: "no_response" })}>
                            <Mail className="h-4 w-4" />
                          </Button>
                        )}
                      {!isFinal && <Button size="sm" variant="outline" onClick={() => openQuoteEditor(rs.id)}>Enter quote</Button>}
                      {!isFinal && rs.status === "responded" && (
                        <Button size="sm" onClick={() => setAwardFor(rs.supplier_id)}>Award…</Button>
                      )}
                      {!isFinal && <Button size="sm" variant="ghost" onClick={() => removeSupplierMut.mutate(rs.id)}><X className="h-4 w-4" /></Button>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RFQComparison
        items={items ?? []}
        suppliers={(rfqSuppliers ?? []) as any}
        quotes={(quotes ?? []) as any}
        disabled={isFinal}
        onAward={(supplierId) => setAwardFor(supplierId)}
      />

      <RFQAttachments rfqId={id!} items={(items ?? []).map((it: any) => ({ id: it.id, description: it.description }))} disabled={isFinal} />

      {/* Enter quote dialog */}
      <Dialog open={!!quoteFor} onOpenChange={(o) => { if (!o) setQuoteFor(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Enter supplier quote — {(rfqSuppliers ?? []).find((rs: any) => rs.id === quoteFor)?.suppliers?.name}</DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-20 text-right">Qty</TableHead>
                <TableHead className="w-32">Unit price</TableHead>
                <TableHead className="w-24">Lead (days)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(items ?? []).map((it: any) => (
                <TableRow key={it.id}>
                  <TableCell>{it.description}</TableCell>
                  <TableCell className="text-right">{Number(it.quantity)}</TableCell>
                  <TableCell>
                    <Input type="number" min={0} step="0.01" value={prices[it.id]?.unit_price ?? 0}
                      onChange={(e) => setPrices((p) => ({ ...p, [it.id]: { ...p[it.id], unit_price: Number(e.target.value) } }))} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" min={0} value={prices[it.id]?.lead_time_days ?? ""}
                      onChange={(e) => setPrices((p) => ({ ...p, [it.id]: { ...p[it.id], lead_time_days: e.target.value ? Number(e.target.value) : null } }))} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuoteFor(null)}>Cancel</Button>
            <Button onClick={() => saveQuoteMut.mutate()} disabled={saveQuoteMut.isPending}>Save quote</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline reason dialog */}
      <Dialog open={!!declineFor} onOpenChange={(o) => { if (!o) setDeclineFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark supplier as declined</DialogTitle>
            <DialogDescription>Optionally record why they declined.</DialogDescription>
          </DialogHeader>
          <Textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="Reason (optional)" rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineFor(null)}>Cancel</Button>
            <Button variant="destructive"
              onClick={() => declineFor && markStatusMut.mutate({ rsId: declineFor, status: "declined", reason: declineReason || undefined })}>
              Confirm decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Award review dialog */}
      {awardFor && awardTarget && (
        <AwardReviewDialog
          open={!!awardFor}
          onOpenChange={(o) => { if (!o) setAwardFor(null); }}
          rfqId={id!}
          supplierId={awardFor}
          supplierName={awardTarget.suppliers?.name ?? ""}
          currency={rfq.currency}
          items={(items ?? []) as any}
          quotes={awardQuotes as any}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["rfq", id] });
            nav("/procurement");
          }}
        />
      )}
    </div>
  );
}
