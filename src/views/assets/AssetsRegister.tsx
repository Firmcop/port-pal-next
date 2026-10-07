import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Boxes, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";

const ASSET_CLASSES = [
  { value: "equipment", label: "Equipment" },
  { value: "vehicle", label: "Vehicle" },
  { value: "facility", label: "Facility" },
  { value: "it", label: "IT" },
  { value: "tool", label: "Tool" },
  { value: "other", label: "Other" },
];

const CONDITIONS = ["new", "good", "fair", "poor", "out_of_service"];

export default function AssetsRegister() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [form, setForm] = useState<any>({
    code: "", name: "", asset_class: "equipment", tag_number: "", serial_number: "",
    manufacturer: "", model: "", category: "", cost: 0, salvage_value: 0,
    useful_life_months: 60, method: "straight_line",
    depot_id: "", custodian_employee_id: "", condition: "good",
    warranty_expiry: "", next_service_at: "", service_interval_days: "",
    acquisition_date: new Date().toISOString().slice(0, 10),
    is_issuable: false,
  });

  const { data: depots } = useQuery({
    queryKey: ["depots-pick"],
    queryFn: async () => (await supabase.from("depots").select("id,name").order("name")).data ?? [],
  });
  const { data: employees } = useQuery({
    queryKey: ["employees-pick"],
    queryFn: async () => (await supabase.from("employees").select("id,name").eq("is_active", true).order("name")).data ?? [],
  });

  const { data: assets } = useQuery({
    queryKey: ["assets-register", classFilter, statusFilter],
    queryFn: async () => {
      let q = supabase.from("fixed_assets" as any)
        .select("*, depots(name), employees:custodian_employee_id(name)")
        .order("code");
      if (classFilter !== "all") q = q.eq("asset_class", classFilter);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return assets ?? [];
    return (assets ?? []).filter((a) =>
      [a.code, a.name, a.tag_number, a.serial_number, a.manufacturer, a.model]
        .filter(Boolean).some((v: string) => v.toLowerCase().includes(s))
    );
  }, [assets, q]);

  const create = useMutation({
    mutationFn: async () => {
      const payload: any = { ...form, organization_id: org.organizationId };
      // Cast blanks to null
      ["depot_id","custodian_employee_id","warranty_expiry","next_service_at","service_interval_days"].forEach((k) => { if (!payload[k]) payload[k] = null; });
      const { error } = await supabase.from("fixed_assets" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets-register"] });
      setOpen(false);
      toast({ title: "Asset added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const importFleet = useMutation({
    mutationFn: async () => {
      const { data: vehicles, error } = await supabase.from("logistics_vehicles").select("*");
      if (error) throw error;
      const existing = new Set((assets ?? []).map((a: any) => a.vehicle_id).filter(Boolean));
      const toInsert = (vehicles ?? []).filter((v: any) => !existing.has(v.id)).map((v: any) => ({
        organization_id: org.organizationId,
        code: `VEH-${v.registration}`,
        name: `${v.make || ""} ${v.model || ""} (${v.registration})`.trim(),
        asset_class: "vehicle",
        vehicle_id: v.id,
        manufacturer: v.make || null,
        model: v.model || null,
        tag_number: v.registration,
        cost: 0, salvage_value: 0, useful_life_months: 60,
        method: "straight_line", condition: "good", status: "active",
        acquisition_date: new Date().toISOString().slice(0, 10),
      }));
      if (!toInsert.length) return 0;
      const { error: ierr } = await supabase.from("fixed_assets" as any).insert(toInsert);
      if (ierr) throw ierr;
      return toInsert.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["assets-register"] });
      toast({ title: n ? `Imported ${n} vehicle(s)` : "Fleet already in register" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="h-6 w-6" />Assets Register</h1>
          <p className="text-muted-foreground">Equipment, vehicles, facilities and IT assets.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => importFleet.mutate()} disabled={importFleet.isPending}>Import from Fleet</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add asset</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>New asset</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                <div><Label>Tag / QR</Label><Input value={form.tag_number} onChange={(e) => setForm({ ...form, tag_number: e.target.value })} /></div>
                <div className="col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div>
                  <Label>Class</Label>
                  <Select value={form.asset_class} onValueChange={(v) => setForm({ ...form, asset_class: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ASSET_CLASSES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
                <div><Label>Serial</Label><Input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} /></div>
                <div><Label>Manufacturer</Label><Input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></div>
                <div><Label>Model</Label><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
                <div>
                  <Label>Condition</Label>
                  <Select value={form.condition} onValueChange={(v) => setForm({ ...form, condition: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Depot</Label>
                  <Select value={form.depot_id || "none"} onValueChange={(v) => setForm({ ...form, depot_id: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {(depots ?? []).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Custodian</Label>
                  <Select value={form.custodian_employee_id || "none"} onValueChange={(v) => setForm({ ...form, custodian_employee_id: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {(employees ?? []).map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Cost</Label><Input type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} /></div>
                <div><Label>Salvage</Label><Input type="number" step="0.01" value={form.salvage_value} onChange={(e) => setForm({ ...form, salvage_value: Number(e.target.value) })} /></div>
                <div><Label>Life (months)</Label><Input type="number" value={form.useful_life_months} onChange={(e) => setForm({ ...form, useful_life_months: Number(e.target.value) })} /></div>
                <div>
                  <Label>Depreciation</Label>
                  <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="straight_line">Straight line</SelectItem>
                      <SelectItem value="declining">Declining balance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Warranty expiry</Label><Input type="date" value={form.warranty_expiry} onChange={(e) => setForm({ ...form, warranty_expiry: e.target.value })} /></div>
                <div><Label>Next service</Label><Input type="date" value={form.next_service_at} onChange={(e) => setForm({ ...form, next_service_at: e.target.value })} /></div>
                <div className="col-span-2 flex items-center gap-2 pt-2 border-t">
                  <input id="issuable" type="checkbox" className="h-4 w-4" checked={form.is_issuable} onChange={(e) => setForm({ ...form, is_issuable: e.target.checked })} />
                  <Label htmlFor="issuable" className="cursor-pointer">Issuable (tool checkout) — allow short-term issue & return to staff/subcontractors, with condition tracking and damage/loss chargeback</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => create.mutate()} disabled={!form.code || !form.name || create.isPending}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search code, name, tag, serial…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Class</Label>
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All classes</SelectItem>
                  {ASSET_CLASSES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="disposed">Disposed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Depot</TableHead>
                <TableHead>Custodian</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">NBV</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!filtered.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No assets.</TableCell></TableRow>
              ) : filtered.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">
                    <Link to={`/assets/${a.id}`} className="hover:underline">{a.code}</Link>
                  </TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{a.asset_class}</Badge></TableCell>
                  <TableCell className="text-xs">{a.depots?.name || "—"}</TableCell>
                  <TableCell className="text-xs">{a.employees?.name || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(a.cost)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(Number(a.cost) - Number(a.accumulated_depreciation || 0))}</TableCell>
                  <TableCell className="text-xs">{a.condition}</TableCell>
                  <TableCell><Badge variant={a.status === "disposed" ? "destructive" : "secondary"}>{a.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
