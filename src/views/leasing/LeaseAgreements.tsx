import { useState } from "react";
import { getDefaultCurrency } from "@/lib/finance-format";
import { CurrencySelect } from "@/components/CurrencySelect";
import { Link } from "@/lib/router";
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
import { Switch } from "@/components/ui/switch";
import { Plus, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/15 text-gray-700 border-gray-300",
  quoted: "bg-info/15 text-info border-info/30",
  active: "bg-success/15 text-success border-success/30",
  suspended: "bg-warning/15 text-warning border-warning/30",
  closed: "bg-slate-500/15 text-slate-700 border-slate-300",
  cancelled: "bg-destructive/15 text-destructive border-destructive/30",
};

export default function LeaseAgreements() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: leases, isLoading } = useQuery({
    queryKey: ["lease-agreements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lease_agreements")
        .select("*, lease_units(id, status), customers(company_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-leasing"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, company_name").eq("is_active", true).order("company_name");
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState({
    lease_number: "",
    customer_id: "",
    lessee_name: "",
    lease_type: "master",
    currency: getDefaultCurrency(),
    start_date: "",
    end_date: "",
    default_per_diem: "0",
    free_days_pickup: "0",
    free_days_redelivery: "5",
    pickup_fee: "0",
    dropoff_fee: "0",
    dpp_enabled: false,
    dpp_rate_per_day: "0",
    payment_terms_days: "30",
    notes: "",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const createLease = useMutation({
    mutationFn: async () => {
      const cust = customers?.find((c) => c.id === form.customer_id);
      const number = form.lease_number || `LSE-${Date.now().toString().slice(-6)}`;
      const { error } = await supabase.from("lease_agreements").insert({
        lease_number: number,
        customer_id: form.customer_id || null,
        lessee_name: form.lessee_name || cust?.company_name || "Unnamed Lessee",
        lease_type: form.lease_type as any,
        currency: form.currency,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        default_per_diem: parseFloat(form.default_per_diem) || 0,
        free_days_pickup: parseInt(form.free_days_pickup) || 0,
        free_days_redelivery: parseInt(form.free_days_redelivery) || 0,
        pickup_fee: parseFloat(form.pickup_fee) || 0,
        dropoff_fee: parseFloat(form.dropoff_fee) || 0,
        dpp_enabled: form.dpp_enabled,
        dpp_rate_per_day: parseFloat(form.dpp_rate_per_day) || 0,
        payment_terms_days: parseInt(form.payment_terms_days) || 30,
        notes: form.notes,
        status: "draft",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lease-agreements"] });
      toast({ title: "Lease agreement created" });
      setOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("lease_agreements").update({ status: status as any }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lease-agreements"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Lease Agreements</h1>
          <p className="text-muted-foreground">{leases?.length ?? 0} agreements</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" />New Agreement</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Lease Agreement</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createLease.mutate(); }} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Lease Number</Label>
                  <Input value={form.lease_number} onChange={(e) => set("lease_number", e.target.value)} placeholder="Auto-generated if empty" />
                </div>
                <div className="space-y-2">
                  <Label>Lease Type</Label>
                  <Select value={form.lease_type} onValueChange={(v) => set("lease_type", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="master">Master Lease</SelectItem>
                      <SelectItem value="long_term">Long-Term</SelectItem>
                      <SelectItem value="short_term">Short-Term</SelectItem>
                      <SelectItem value="one_way">One-Way</SelectItem>
                      <SelectItem value="spot">Spot</SelectItem>
                      <SelectItem value="lease_purchase">Lease-Purchase</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Lessee (Customer)</Label>
                  <Select value={form.customer_id} onValueChange={(v) => { set("customer_id", v); const c = customers?.find(x => x.id === v); if (c) set("lessee_name", c.company_name); }}>
                    <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
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
                  <Label>Currency</Label>
                  <CurrencySelect value={form.currency} onChange={(v) => set("currency", v)} />
                </div>
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Default Per Diem</Label>
                  <Input type="number" step="0.01" value={form.default_per_diem} onChange={(e) => set("default_per_diem", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Free Days (Pickup)</Label>
                  <Input type="number" value={form.free_days_pickup} onChange={(e) => set("free_days_pickup", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Free Days (Redelivery)</Label>
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
                  <Label>Payment Terms (days)</Label>
                  <Input type="number" value={form.payment_terms_days} onChange={(e) => set("payment_terms_days", e.target.value)} />
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">Damage Protection Plan (DPP)</Label>
                    <p className="text-xs text-muted-foreground">Charge a daily fee that waives or caps redelivery repair charges.</p>
                  </div>
                  <Switch checked={form.dpp_enabled} onCheckedChange={(v) => set("dpp_enabled", v)} />
                </div>
                {form.dpp_enabled && (
                  <div className="space-y-2">
                    <Label>DPP Rate / Day</Label>
                    <Input type="number" step="0.01" value={form.dpp_rate_per_day} onChange={(e) => set("dpp_rate_per_day", e.target.value)} />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Internal notes" />
              </div>
              <Button type="submit" className="w-full" disabled={createLease.isPending}>Create Agreement</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lease #</TableHead>
                <TableHead>Lessee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Per Diem</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead>Term</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={8} />
              ) : !leases?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No agreements yet. Create one to get started.</TableCell></TableRow>
              ) : (
                leases.map((l: any) => {
                  const onHire = l.lease_units?.filter((u: any) => u.status === "on_hire").length ?? 0;
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-sm">{l.lease_number}</TableCell>
                      <TableCell>{l.lessee_name}</TableCell>
                      <TableCell className="capitalize">{l.lease_type.replace("_", " ")}</TableCell>
                      <TableCell className="text-right font-mono">{l.currency} {parseFloat(l.default_per_diem).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{onHire} / {l.lease_units?.length ?? 0}</TableCell>
                      <TableCell className="text-xs">{l.start_date ?? "—"} → {l.end_date ?? "—"}</TableCell>
                      <TableCell>
                        <Select value={l.status} onValueChange={(v) => updateStatus.mutate({ id: l.id, status: v })}>
                          <SelectTrigger className="h-8 w-32">
                            <Badge variant="outline" className={STATUS_COLORS[l.status]}>{l.status}</Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {Object.keys(STATUS_COLORS).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/leasing/agreements/${l.id}`}><ExternalLink className="h-4 w-4" /></Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
