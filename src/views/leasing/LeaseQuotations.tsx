import { useState } from "react";
import { getDefaultCurrency } from "@/lib/finance-format";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, FileCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { HEIGHT_CLASSES, HEIGHT_CLASS_LABELS, formatCategory } from "@/lib/container-constants";

export default function LeaseQuotations() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: quotes, isLoading } = useQuery({
    queryKey: ["lease-quotations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lease_quotations").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-leasing-q"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, company_name").eq("is_active", true).order("company_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: rateCards } = useQuery({
    queryKey: ["lease-rate-cards-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lease_rate_cards")
        .select("id, container_size, container_category, height_class, per_diem_rate, lease_id, lease_agreements(lease_number, status)")
        .order("created_at", { ascending: false });
      if (error) return [];
      return data ?? [];
    },
  });

  const { data: stockCounts } = useQuery({
    queryKey: ["containers-stock-by-spec"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("containers")
        .select("size, category, height_class, status")
        .eq("status", "available");
      if (error) return [];
      return data ?? [];
    },
  });
  const [form, setForm] = useState({
    quote_number: "",
    customer_id: "",
    lessee_name: "",
    lease_type: "master",
    currency: getDefaultCurrency(),
    proposed_per_diem: "0",
    free_days_pickup: "0",
    free_days_redelivery: "5",
    units_offered: "1",
    container_size: "20",
    container_category: "dry",
    height_class: "LC",
    valid_until: "",
    pickup_fee: "0",
    dropoff_fee: "0",
    dpp_offered: false,
    dpp_rate_per_day: "0",
    notes: "",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const createQuote = useMutation({
    mutationFn: async () => {
      const cust = customers?.find((c) => c.id === form.customer_id);
      const number = form.quote_number || `LQ-${Date.now().toString().slice(-6)}`;
      const { error } = await supabase.from("lease_quotations").insert({
        quote_number: number,
        customer_id: form.customer_id || null,
        lessee_name: form.lessee_name || cust?.company_name || "Unnamed",
        lease_type: form.lease_type as any,
        currency: form.currency,
        proposed_per_diem: parseFloat(form.proposed_per_diem),
        free_days_pickup: parseInt(form.free_days_pickup),
        free_days_redelivery: parseInt(form.free_days_redelivery),
        units_offered: parseInt(form.units_offered),
        container_size: form.container_size,
        container_category: form.container_category,
        height_class: form.container_category === "dry" ? (form.height_class || "LC") as any : null,
        valid_until: form.valid_until || null,
        pickup_fee: parseFloat(form.pickup_fee),
        dropoff_fee: parseFloat(form.dropoff_fee),
        dpp_offered: form.dpp_offered,
        dpp_rate_per_day: parseFloat(form.dpp_rate_per_day),
        notes: form.notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lease-quotations"] });
      toast({ title: "Quotation created" });
      setOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const convertQuote = useMutation({
    mutationFn: async (q: any) => {
      const leaseNumber = `LSE-${Date.now().toString().slice(-6)}`;
      const { data: lease, error } = await supabase.from("lease_agreements").insert({
        lease_number: leaseNumber,
        customer_id: q.customer_id,
        lessee_name: q.lessee_name,
        lease_type: q.lease_type,
        currency: q.currency,
        default_per_diem: q.proposed_per_diem,
        free_days_pickup: q.free_days_pickup,
        free_days_redelivery: q.free_days_redelivery,
        pickup_fee: q.pickup_fee,
        dropoff_fee: q.dropoff_fee,
        dpp_enabled: q.dpp_offered,
        dpp_rate_per_day: q.dpp_rate_per_day,
        start_date: q.proposed_start_date,
        end_date: q.proposed_end_date,
        container_size: q.container_size,
        container_category: q.container_category,
        height_class: q.container_category === "dry" ? q.height_class : null,
        notes: q.notes,
        status: "active",
      }).select().single();
      if (error) throw error;
      await supabase.from("lease_quotations").update({ status: "accepted", converted_lease_id: lease.id }).eq("id", q.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lease-quotations"] });
      qc.invalidateQueries({ queryKey: ["lease-agreements"] });
      toast({ title: "Quote converted to active lease agreement" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusColor: Record<string, string> = {
    pending: "bg-warning/15 text-warning border-warning/30",
    sent: "bg-info/15 text-info border-info/30",
    accepted: "bg-success/15 text-success border-success/30",
    rejected: "bg-destructive/15 text-destructive border-destructive/30",
    expired: "bg-gray-500/15 text-gray-700 border-gray-300",
  };

  // Suggested per-diem from existing rate cards matching size/category/(height_class).
  const matchingCards = (rateCards ?? []).filter((c: any) =>
    String(c.container_size) === form.container_size &&
    c.container_category === form.container_category &&
    (form.container_category !== "dry" || c.height_class === form.height_class)
  );
  const suggestedRate = matchingCards.length
    ? matchingCards.reduce((s: number, c: any) => s + Number(c.per_diem_rate), 0) / matchingCards.length
    : null;

  // Available units in stock matching spec.
  const matchingStock = (stockCounts ?? []).filter((c: any) =>
    String(c.size) === form.container_size &&
    c.category === form.container_category &&
    (form.container_category !== "dry" || c.height_class === form.height_class)
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Lease Quotations</h1>
          <p className="text-muted-foreground">{quotes?.length ?? 0} quotes</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" />New Quote</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Lease Quotation</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createQuote.mutate(); }} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Customer</Label>
                  <Select value={form.customer_id} onValueChange={(v) => { set("customer_id", v); const c = customers?.find(x => x.id === v); if (c) set("lessee_name", c.company_name); }}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {customers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Lessee Name *</Label>
                  <Input value={form.lessee_name} onChange={(e) => set("lessee_name", e.target.value)} required />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Lease Type</Label>
                  <Select value={form.lease_type} onValueChange={(v) => set("lease_type", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="master">Master</SelectItem>
                      <SelectItem value="long_term">Long-Term</SelectItem>
                      <SelectItem value="short_term">Short-Term</SelectItem>
                      <SelectItem value="one_way">One-Way</SelectItem>
                      <SelectItem value="spot">Spot</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Container Size</Label>
                  <Select value={form.container_size} onValueChange={(v) => set("container_size", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="20">20'</SelectItem>
                      <SelectItem value="40">40'</SelectItem>
                      <SelectItem value="45">45'</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={form.container_category} onValueChange={(v) => set("container_category", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dry">Dry</SelectItem>
                      <SelectItem value="reefer">Reefer</SelectItem>
                      <SelectItem value="tank">Tank</SelectItem>
                      <SelectItem value="flat_rack">Flat Rack</SelectItem>
                      <SelectItem value="open_top">Open Top</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.container_category === "dry" && (
                <div className="space-y-2">
                  <Label>Height Class *</Label>
                  <Select value={form.height_class} onValueChange={(v) => set("height_class", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HEIGHT_CLASSES.map((h) => <SelectItem key={h} value={h}>{HEIGHT_CLASS_LABELS[h]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex flex-wrap gap-2 items-center text-xs">
                <Badge variant="outline" className="bg-info/10 border-info/30 text-info">
                  Spec: {form.container_size}' {formatCategory(form.container_category, form.container_category === "dry" ? form.height_class : null)}
                </Badge>
                <Badge variant="outline" className={matchingStock > 0 ? "bg-success/10 border-success/30 text-success" : "bg-warning/10 border-warning/30 text-warning"}>
                  {matchingStock} matching unit{matchingStock === 1 ? "" : "s"} in stock
                </Badge>
                {suggestedRate !== null && (
                  <span className="text-muted-foreground">
                    Suggested per-diem: <strong>{form.currency} {suggestedRate.toFixed(2)}/day</strong> (avg of {matchingCards.length} rate card{matchingCards.length === 1 ? "" : "s"})
                    <Button type="button" size="sm" variant="ghost" className="h-6 px-2 ml-1" onClick={() => set("proposed_per_diem", suggestedRate.toFixed(2))}>Use</Button>
                  </span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-2">
                  <Label>Per Diem</Label>
                  <Input type="number" step="0.01" value={form.proposed_per_diem} onChange={(e) => set("proposed_per_diem", e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Units</Label>
                  <Input type="number" value={form.units_offered} onChange={(e) => set("units_offered", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Free Days (P)</Label>
                  <Input type="number" value={form.free_days_pickup} onChange={(e) => set("free_days_pickup", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Free Days (R)</Label>
                  <Input type="number" value={form.free_days_redelivery} onChange={(e) => set("free_days_redelivery", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Pickup Fee</Label>
                  <Input type="number" step="0.01" value={form.pickup_fee} onChange={(e) => set("pickup_fee", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Drop-off Fee</Label>
                  <Input type="number" step="0.01" value={form.dropoff_fee} onChange={(e) => set("dropoff_fee", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Valid Until</Label>
                  <Input type="date" value={form.valid_until} onChange={(e) => set("valid_until", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes / Terms</Label>
                <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={createQuote.isPending}>Create Quote</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote #</TableHead>
                <TableHead>Lessee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Spec</TableHead>
                <TableHead className="text-right">Per Diem</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead>Valid Until</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={9} />
              ) : !quotes?.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No quotations yet.</TableCell></TableRow>
              ) : (
                quotes.map((q: any) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-mono text-sm">{q.quote_number}</TableCell>
                    <TableCell>{q.lessee_name}</TableCell>
                    <TableCell className="capitalize">{q.lease_type.replace("_", " ")}</TableCell>
                    <TableCell className="text-xs">{q.container_size ? `${q.container_size}' ${formatCategory(q.container_category, q.height_class)}` : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{q.currency} {parseFloat(q.proposed_per_diem).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{q.units_offered}</TableCell>
                    <TableCell className="text-xs">{q.valid_until ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={statusColor[q.status]}>{q.status}</Badge></TableCell>
                    <TableCell>
                      {q.status !== "accepted" && (
                        <Button size="sm" variant="outline" onClick={() => convertQuote.mutate(q)} disabled={convertQuote.isPending}>
                          <FileCheck className="h-3 w-3 mr-1" />Convert
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
