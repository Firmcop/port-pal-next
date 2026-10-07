import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Search, Truck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useRowSelection } from "@/hooks/use-row-selection";
import { HeaderCheckbox, RowCheckbox } from "@/components/bulk/SelectionCheckbox";
import { RegistryActions, BulkActions } from "@/components/bulk/RegistryActions";
import { REGISTRIES } from "@/config/bulk-registries";

export default function TrucksDrivers() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: records, isLoading } = useQuery({
    queryKey: ["trucks-drivers", search],
    queryFn: async () => {
      let q = supabase.from("trucks_drivers").select("*").order("created_at", { ascending: false });
      if (search) q = q.or(`truck_plate.ilike.%${search}%,driver_name.ilike.%${search}%,company.ilike.%${search}%`);
      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data;
    },
  });

  const createRecord = useMutation({
    mutationFn: async (form: any) => {
      const { error } = await supabase.from("trucks_drivers").insert(form);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trucks-drivers"] });
      toast({ title: "Truck/driver registered" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("trucks_drivers").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trucks-drivers"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [form, setForm] = useState({
    truck_plate: "", driver_name: "", driver_license: "", driver_phone: "", company: "", notes: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const selection = useRowSelection<any>(records as any);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Trucks & Drivers</h1>
          <p className="text-muted-foreground">{records?.length ?? 0} registered</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <RegistryActions config={REGISTRIES.trucks_drivers.config} schema={REGISTRIES.trucks_drivers.schema} allRows={records as any} selectedIds={selection.selectedIds} onClearSelection={selection.clear} />
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" />Register</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Register Truck / Driver</DialogTitle></DialogHeader>
              <form
                onSubmit={(e) => { e.preventDefault(); createRecord.mutate(form); }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Truck Plate *</Label>
                    <Input value={form.truck_plate} onChange={(e) => set("truck_plate", e.target.value.toUpperCase())} required className="font-mono" />
                  </div>
                  <div className="space-y-2">
                    <Label>Driver Name *</Label>
                    <Input value={form.driver_name} onChange={(e) => set("driver_name", e.target.value)} required />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>License Number</Label>
                    <Input value={form.driver_license} onChange={(e) => set("driver_license", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input value={form.driver_phone} onChange={(e) => set("driver_phone", e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Company</Label>
                  <Input value={form.company} onChange={(e) => set("company", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={createRecord.isPending}>Register</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <BulkActions
        config={REGISTRIES.trucks_drivers.config}
        selectedIds={selection.selectedIds}
        selectedRows={selection.selectedRows}
        onClear={selection.clear}
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search plate, driver, or company..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <HeaderCheckbox allSelected={selection.allSelected} someSelected={selection.someSelected} onToggle={selection.toggleAll} />
                </TableHead>
                <TableHead>Truck Plate</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>License</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={8} />
              ) : !records?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No trucks/drivers registered</TableCell></TableRow>
              ) : (
                records.map((r: any) => (
                  <TableRow key={r.id} data-state={selection.isSelected(r.id) ? "selected" : undefined}>
                    <TableCell><RowCheckbox checked={selection.isSelected(r.id)} onToggle={() => selection.toggle(r.id)} /></TableCell>
                    <TableCell className="font-mono font-medium">{r.truck_plate}</TableCell>
                    <TableCell>{r.driver_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.driver_license ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.driver_phone ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.company ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={r.is_active ? "bg-success/15 text-success border-success/30" : "bg-gray-500/15 text-gray-700 border-gray-300"}>
                        {r.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Switch checked={r.is_active} onCheckedChange={(v) => toggleActive.mutate({ id: r.id, is_active: v })} />
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
