import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, FileText, CheckCircle, BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "@/lib/router";
import { format } from "date-fns";
import { TemplatePicker } from "@/components/quotes/TemplatePicker";
import { QuoteAdminActions } from "@/components/quotes/QuoteAdminActions";
import { Switch } from "@/components/ui/switch";


const statusColor: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_approval: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  sent: "bg-info/15 text-info",
  accepted: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  expired: "bg-warning/15 text-warning",
};

const STATUS_OPTIONS = ["draft", "pending_approval", "approved", "sent", "accepted", "rejected", "expired"];

export default function Quotes() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [pendingQuoteId, setPendingQuoteId] = useState<string | null>(null);
  const [form, setForm] = useState({ customer_id: "", total_amount: "", valid_until: "", notes: "", start_from_template: false });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const [showArchived, setShowArchived] = useState(false);

  const { data: quotes, isLoading } = useQuery({
    queryKey: ["quotes", showArchived],
    queryFn: async () => {
      let q = supabase.from("quotes").select("*, customers(company_name), deals(title)").order("created_at", { ascending: false });
      if (!showArchived) q = q.is("archived_at", null);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },

  });

  const { data: customers } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, company_name").eq("is_active", true).order("company_name");
      if (error) throw error;
      return data;
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const num = `QTE-${Date.now().toString(36).toUpperCase()}`;
      const { data, error } = await supabase.from("quotes").insert({
        customer_id: form.customer_id,
        quote_number: num,
        total_amount: parseFloat(form.total_amount) || 0,
        valid_until: form.valid_until || null,
        notes: form.notes || null,
        created_by: user?.id,
      } as any).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      toast({ title: "Quote created" });
      setOpen(false);
      const newId = data?.id;
      const wantsTemplate = form.start_from_template;
      setForm({ customer_id: "", total_amount: "", valid_until: "", notes: "", start_from_template: false });
      if (newId && wantsTemplate) {
        setPendingQuoteId(newId);
        setTplOpen(true);
      } else if (newId) {
        navigate(`/quotes/${newId}`);
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("quotes").update({ status } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["quotes"] }); toast({ title: "Quote updated" }); },
  });

  const acceptAndCreateOrder = useMutation({
    mutationFn: async (quote: any) => {
      // Mark quote as accepted
      await supabase.from("quotes").update({ status: "accepted" } as any).eq("id", quote.id);
      // Create sales order
      const num = `SO-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await supabase.from("sales_orders").insert({
        order_number: num,
        quote_id: quote.id,
        customer_id: quote.customer_id,
        total_amount: quote.total_amount || 0,
        created_by: user?.id,
      } as any);
      if (error) throw error;
      // Auto-generate invoice
      const { data, error: invErr } = await (supabase as any).rpc("generate_invoice_from_quote", { _quote_id: quote.id });
      if (invErr) throw invErr;
      return Array.isArray(data) ? data[0] : data;
    },
    onSuccess: (row: any) => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      toast({
        title: "Sales order created",
        description: row?.invoice_number
          ? `Invoice ${row.invoice_number} ${row.already_existed ? "already existed" : "generated"}.`
          : undefined,
      });
      navigate("/sales-orders");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6" />Quotations</h1>
          <p className="text-muted-foreground">{quotes?.length ?? 0} quotes</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
            Show archived
          </label>
          <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />New Quote</Button>
        </div>
      </div>


      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Deal</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Valid Until</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !quotes?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No quotes yet</TableCell></TableRow>
              ) : quotes.map((q: any) => (
                <TableRow key={q.id} className="cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/quotes/${q.id}`)}>
                  <TableCell className="font-mono text-xs text-primary underline">
                    {q.quote_number}
                    {q.archived_at && <Badge variant="secondary" className="ml-2">Archived</Badge>}
                  </TableCell>
                  <TableCell className="font-medium">{q.customers?.company_name ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{q.deals?.title ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(q.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-xs">{q.valid_until ? format(new Date(q.valid_until), "dd MMM yyyy") : "—"}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Select value={q.status} disabled={!!q.archived_at} onValueChange={(v) => updateStatus.mutate({ id: q.id, status: v })}>
                      <SelectTrigger className="h-7 w-28"><Badge className={statusColor[q.status] ?? ""} variant="secondary">{q.status}</Badge></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s.replace("_"," ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(q.created_at), "dd MMM yyyy")}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {!q.archived_at && (q.status === "draft" || q.status === "sent") && (
                        <Button size="sm" variant="outline" onClick={() => acceptAndCreateOrder.mutate(q)}>
                          <CheckCircle className="mr-1 h-3 w-3" />Accept & Order
                        </Button>
                      )}
                      <QuoteAdminActions quote={q} />
                    </div>
                  </TableCell>

                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Quote</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Customer *</Label>
              <Select value={form.customer_id} onValueChange={(v) => set("customer_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>{customers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Total Amount</Label><Input type="number" value={form.total_amount} onChange={(e) => set("total_amount", e.target.value)} /></div>
              <div className="space-y-2"><Label>Valid Until</Label><Input type="date" value={form.valid_until} onChange={(e) => set("valid_until", e.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm cursor-pointer border rounded p-2 bg-muted/30">
              <input
                type="checkbox"
                checked={form.start_from_template}
                onChange={(e) => set("start_from_template", e.target.checked)}
              />
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <span>Start from a prebuilt template (you can edit items afterwards)</span>
            </label>
            <Button type="submit" className="w-full" disabled={createMut.isPending || !form.customer_id}>
              {form.start_from_template ? "Create & Pick Template" : "Create Quote"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <TemplatePicker
        open={tplOpen}
        kind="full"
        onOpenChange={(v) => {
          setTplOpen(v);
          if (!v && pendingQuoteId) {
            const id = pendingQuoteId;
            setPendingQuoteId(null);
            navigate(`/quotes/${id}`);
          }
        }}
        onPick={async (templateId, mode) => {
          if (!pendingQuoteId) return;
          const { error } = await (supabase as any).rpc("apply_quote_template", {
            _quote_id: pendingQuoteId, _template_id: templateId, _mode: mode,
          });
          if (error) {
            toast({ title: "Error applying template", description: error.message, variant: "destructive" });
            return;
          }
          toast({ title: "Template applied" });
        }}
      />
    </div>
  );
}
