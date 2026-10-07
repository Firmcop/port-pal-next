import { useState } from "react";
import { useParams, Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Plus, ArrowRightCircle, ArrowLeftCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { HEIGHT_CLASSES, HEIGHT_CLASS_LABELS, formatCategory } from "@/lib/container-constants";

export default function LeaseAgreementDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [unitDialog, setUnitDialog] = useState(false);
  const [rateDialog, setRateDialog] = useState(false);

  const { data: lease } = useQuery({
    queryKey: ["lease-agreement", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("lease_agreements").select("*, customers(company_name)").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: units } = useQuery({
    queryKey: ["lease-units", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("lease_units").select("*, containers(container_number, size, category, status)").eq("lease_id", id!).order("on_hire_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: rateCards } = useQuery({
    queryKey: ["lease-rates", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("lease_rate_cards").select("*").eq("lease_id", id!).order("container_size").order("tier_min_days");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: runs } = useQuery({
    queryKey: ["lease-runs", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("lease_invoices_run").select("*").eq("lease_id", id!).order("generated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: availableContainers } = useQuery({
    queryKey: ["available-containers-for-lease"],
    queryFn: async () => {
      const { data, error } = await supabase.from("containers").select("id, container_number, size, category, height_class, status").in("status", ["available", "allocated"]).order("container_number").limit(200);
      if (error) throw error;
      return data;
    },
    enabled: unitDialog,
  });

  const [unitForm, setUnitForm] = useState({ container_id: "", on_hire_at: new Date().toISOString().slice(0, 10), effective_per_diem: "0", dpp_active: false });
  const [rateForm, setRateForm] = useState({ container_size: "20", container_category: "dry", height_class: "LC", per_diem_rate: "0", tier_min_days: "0", tier_max_days: "" });

  const onHire = useMutation({
    mutationFn: async () => {
      if (!unitForm.container_id) throw new Error("Select a container");
      const { error } = await supabase.from("lease_units").insert({
        lease_id: id!,
        container_id: unitForm.container_id,
        on_hire_at: unitForm.on_hire_at,
        effective_per_diem: parseFloat(unitForm.effective_per_diem) || lease?.default_per_diem || 0,
        dpp_active: unitForm.dpp_active,
        status: "on_hire",
      });
      if (error) throw error;
      // Mark container as on_lease
      await supabase.from("containers").update({ status: "on_lease" as any }).eq("id", unitForm.container_id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lease-units", id] });
      toast({ title: "Container on-hired" });
      setUnitDialog(false);
      setUnitForm({ container_id: "", on_hire_at: new Date().toISOString().slice(0, 10), effective_per_diem: "0", dpp_active: false });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const offHire = useMutation({
    mutationFn: async (unit: any) => {
      const { error } = await supabase.from("lease_units").update({ off_hire_at: new Date().toISOString(), status: "off_hire" }).eq("id", unit.id);
      if (error) throw error;
      if (unit.container_id) await supabase.from("containers").update({ status: "available" }).eq("id", unit.container_id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lease-units", id] });
      toast({ title: "Container off-hired" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addRate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("lease_rate_cards").insert({
        lease_id: id!,
        container_size: rateForm.container_size,
        container_category: rateForm.container_category,
        height_class: rateForm.container_category === "dry" ? (rateForm.height_class || "LC") as any : null,
        per_diem_rate: parseFloat(rateForm.per_diem_rate),
        tier_min_days: parseInt(rateForm.tier_min_days) || 0,
        tier_max_days: rateForm.tier_max_days ? parseInt(rateForm.tier_max_days) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lease-rates", id] });
      toast({ title: "Rate card added" });
      setRateDialog(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!lease) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild size="sm" variant="ghost"><Link to="/leasing/agreements"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{lease.lease_number}</h1>
          <p className="text-muted-foreground">{lease.lessee_name} · <span className="capitalize">{lease.lease_type.replace("_", " ")}</span></p>
        </div>
        <Badge variant="outline" className="text-sm">{lease.status}</Badge>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="units">Units ({units?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="rates">Rate Cards ({rateCards?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="invoices">Billing Runs ({runs?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Default Per Diem</CardTitle></CardHeader><CardContent className="text-xl font-bold font-mono">{lease.currency} {Number(lease.default_per_diem).toFixed(2)}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Free Days (Pickup / Redelivery)</CardTitle></CardHeader><CardContent className="text-xl font-bold">{lease.free_days_pickup} / {lease.free_days_redelivery}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Pickup / Drop-off Fee</CardTitle></CardHeader><CardContent className="text-xl font-bold font-mono">{Number(lease.pickup_fee).toFixed(0)} / {Number(lease.dropoff_fee).toFixed(0)}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">DPP</CardTitle></CardHeader><CardContent className="text-xl font-bold">{lease.dpp_enabled ? `${lease.currency} ${Number(lease.dpp_rate_per_day).toFixed(2)}/day` : "Off"}</CardContent></Card>
          </div>
          <Card className="mt-4">
            <CardHeader><CardTitle>Terms</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><strong>Term:</strong> {lease.start_date ?? "—"} → {lease.end_date ?? "—"}</div>
              <div><strong>Payment terms:</strong> {lease.payment_terms_days} days</div>
              <div><strong>Min lease days:</strong> {lease.min_lease_days}</div>
              <div><strong>Auto-renew:</strong> {lease.auto_renew ? "Yes" : "No"}</div>
              {lease.notes && <div><strong>Notes:</strong> {lease.notes}</div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="units">
          <div className="flex justify-end mb-3">
            <Dialog open={unitDialog} onOpenChange={setUnitDialog}>
              <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />On-Hire Container</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>On-Hire a Container</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); onHire.mutate(); }} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Container *</Label>
                    <Select value={unitForm.container_id} onValueChange={(v) => setUnitForm({ ...unitForm, container_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
                      <SelectContent>
                        {availableContainers?.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.container_number} — {c.size}' {formatCategory(c.category, (c as any).height_class)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>On-Hire Date</Label><Input type="date" value={unitForm.on_hire_at} onChange={(e) => setUnitForm({ ...unitForm, on_hire_at: e.target.value })} /></div>
                    <div className="space-y-2"><Label>Effective Per Diem</Label><Input type="number" step="0.01" value={unitForm.effective_per_diem} onChange={(e) => setUnitForm({ ...unitForm, effective_per_diem: e.target.value })} placeholder={String(lease.default_per_diem)} /></div>
                  </div>
                  {lease.dpp_enabled && (
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <Label>DPP Active for this unit</Label>
                      <Switch checked={unitForm.dpp_active} onCheckedChange={(v) => setUnitForm({ ...unitForm, dpp_active: v })} />
                    </div>
                  )}
                  <Button type="submit" className="w-full" disabled={onHire.isPending}><ArrowRightCircle className="mr-1 h-4 w-4" />On-Hire</Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Container</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>On-Hire</TableHead>
                    <TableHead>Off-Hire</TableHead>
                    <TableHead className="text-right">Per Diem</TableHead>
                    <TableHead>DPP</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!units?.length ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No units on-hired yet.</TableCell></TableRow>
                  ) : units.map((u: any) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-mono text-xs">{u.containers?.container_number ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{u.status.replace("_", " ")}</Badge></TableCell>
                      <TableCell className="text-xs">{u.on_hire_at ? new Date(u.on_hire_at).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-xs">{u.off_hire_at ? new Date(u.off_hire_at).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{parseFloat(u.effective_per_diem).toFixed(2)}</TableCell>
                      <TableCell>{u.dpp_active ? "Yes" : "No"}</TableCell>
                      <TableCell>
                        {u.status === "on_hire" && (
                          <Button size="sm" variant="outline" onClick={() => offHire.mutate(u)}><ArrowLeftCircle className="h-3 w-3 mr-1" />Off-Hire</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rates">
          <div className="flex justify-end mb-3">
            <Dialog open={rateDialog} onOpenChange={setRateDialog}>
              <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Add Rate Card</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Tiered Rate</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); addRate.mutate(); }} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Size</Label>
                      <Select value={rateForm.container_size} onValueChange={(v) => setRateForm({ ...rateForm, container_size: v })}>
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
                      <Select value={rateForm.container_category} onValueChange={(v) => setRateForm({ ...rateForm, container_category: v })}>
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
                  {rateForm.container_category === "dry" && (
                    <div className="space-y-2">
                      <Label>Height Class *</Label>
                      <Select value={rateForm.height_class} onValueChange={(v) => setRateForm({ ...rateForm, height_class: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {HEIGHT_CLASSES.map((h) => <SelectItem key={h} value={h}>{HEIGHT_CLASS_LABELS[h]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2"><Label>Rate / Day</Label><Input type="number" step="0.01" value={rateForm.per_diem_rate} onChange={(e) => setRateForm({ ...rateForm, per_diem_rate: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Tier From (days)</Label><Input type="number" value={rateForm.tier_min_days} onChange={(e) => setRateForm({ ...rateForm, tier_min_days: e.target.value })} /></div>
                    <div className="space-y-2"><Label>Tier To (days)</Label><Input type="number" value={rateForm.tier_max_days} onChange={(e) => setRateForm({ ...rateForm, tier_max_days: e.target.value })} placeholder="∞" /></div>
                  </div>
                  <Button type="submit" className="w-full" disabled={addRate.isPending}>Add Rate</Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Size</TableHead><TableHead>Category</TableHead><TableHead>Tier</TableHead><TableHead className="text-right">Rate/Day</TableHead></TableRow></TableHeader>
                <TableBody>
                  {!rateCards?.length ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No rate cards. Default per-diem will be used.</TableCell></TableRow>
                  ) : rateCards.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.container_size}'</TableCell>
                      <TableCell>{formatCategory(r.container_category, r.height_class)}</TableCell>
                      <TableCell className="text-xs">{r.tier_min_days}+ {r.tier_max_days ? `to ${r.tier_max_days}` : ""} days</TableCell>
                      <TableCell className="text-right font-mono">{lease.currency} {parseFloat(r.per_diem_rate).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Generated</TableHead><TableHead>Period</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                <TableBody>
                  {!runs?.length ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No billing runs for this lease yet.</TableCell></TableRow>
                  ) : runs.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{new Date(r.generated_at).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{r.period_start} → {r.period_end}</TableCell>
                      <TableCell className="text-right">{r.units_count}</TableCell>
                      <TableCell className="text-right font-mono">{lease.currency} {parseFloat(r.total_amount).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
