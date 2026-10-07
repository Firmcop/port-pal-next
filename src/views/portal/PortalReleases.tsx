import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  used: "bg-info/15 text-info",
  expired: "bg-gray-500/15 text-gray-700",
  cancelled: "bg-destructive/15 text-destructive",
};

export default function PortalReleases() {
  const { customerId } = usePortalAuth();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const emptyForm = {
    release_type: "pickup",
    container_number: "",
    consignee_name: "",
    truck_plate: "",
    driver_name: "",
    driver_id_number: "",
    valid_from: "",
    valid_until: "",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: releases, isLoading } = useQuery({
    queryKey: ["portal-releases", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("release_instructions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error("No customer linked");
      const num = `REL-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await supabase.from("release_instructions").insert({
        instruction_number: num,
        customer_id: customerId,
        container_number: form.container_number || null,
        release_type: form.release_type,
        consignee_name: form.consignee_name || null,
        truck_plate: form.truck_plate || null,
        driver_name: form.driver_name || null,
        driver_id_number: form.driver_id_number || null,
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        notes: form.notes || null,
        source: "portal",
        created_by: user?.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-releases"] });
      toast({ title: "Release instruction submitted" });
      setDialogOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Release Instructions</h1>
          <p className="text-muted-foreground">Issue and track container release orders</p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" />New Release</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Instruction #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Consignee</TableHead>
                <TableHead>Valid Until</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={7} />
              ) : !releases?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No release instructions</TableCell></TableRow>
              ) : releases.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium font-mono text-sm">{r.instruction_number}</TableCell>
                  <TableCell className="capitalize text-sm">{r.release_type}</TableCell>
                  <TableCell className="font-mono text-sm">{r.container_number ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.consignee_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.valid_until ? format(new Date(r.valid_until), "dd MMM yyyy") : "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={statusColors[r.status] ?? ""}>{r.status}</Badge></TableCell>
                  <TableCell className="text-sm capitalize">{r.source}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Release Instruction</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Release Type</Label>
                <Select value={form.release_type} onValueChange={(v) => set("release_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pickup">Pickup</SelectItem>
                    <SelectItem value="delivery">Delivery</SelectItem>
                    <SelectItem value="reposition">Reposition</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Container Number</Label>
                <Input value={form.container_number} onChange={(e) => set("container_number", e.target.value)} placeholder="e.g. MSKU1234567" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Consignee Name</Label>
              <Input value={form.consignee_name} onChange={(e) => set("consignee_name", e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Truck Plate</Label>
                <Input value={form.truck_plate} onChange={(e) => set("truck_plate", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Driver Name</Label>
                <Input value={form.driver_name} onChange={(e) => set("driver_name", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Driver ID</Label>
                <Input value={form.driver_id_number} onChange={(e) => set("driver_id_number", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valid From</Label>
                <Input type="datetime-local" value={form.valid_from} onChange={(e) => set("valid_from", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Valid Until</Label>
                <Input type="datetime-local" value={form.valid_until} onChange={(e) => set("valid_until", e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
            </div>
            <Button type="submit" className="w-full" disabled={create.isPending}>Submit Release</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
