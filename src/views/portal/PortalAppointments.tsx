import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, FileDown } from "lucide-react";
import { downloadAppointmentPdf } from "@/lib/appointment-pdf";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  scheduled: "bg-info/15 text-info",
  arrived: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
};

export default function PortalAppointments() {
  const { customerId, customerName } = usePortalAuth();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    appointment_type: "drop_off",
    container_number: "",
    scheduled_at: "",
    truck_plate: "",
    driver_name: "",
    driver_license: "",
    notes: "",
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: appointments, isLoading } = useQuery({
    queryKey: ["portal-appointments", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gate_appointments")
        .select("*")
        .order("scheduled_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const num = `APT-P-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await supabase.from("gate_appointments").insert({
        appointment_number: num,
        appointment_type: form.appointment_type,
        container_number: form.container_number || null,
        scheduled_at: form.scheduled_at,
        truck_plate: form.truck_plate || null,
        driver_name: form.driver_name || null,
        driver_license: form.driver_license || null,
        shipping_line: customerName,
        notes: form.notes || null,
        created_by: user?.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-appointments"] });
      toast({ title: "Appointment created" });
      setDialogOpen(false);
      setForm({ appointment_type: "drop_off", container_number: "", scheduled_at: "", truck_plate: "", driver_name: "", driver_license: "", notes: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Appointments</h1>
          <p className="text-muted-foreground">Schedule and track gate appointments</p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" />New Appointment</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Truck</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={7} />
              ) : !appointments?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No appointments</TableCell></TableRow>
              ) : appointments.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium font-mono text-sm">{a.appointment_number}</TableCell>
                  <TableCell className="capitalize text-sm">{a.appointment_type?.replace("_", " ")}</TableCell>
                  <TableCell className="font-mono text-sm">{a.container_number ?? "—"}</TableCell>
                  <TableCell className="text-sm">{format(new Date(a.scheduled_at), "dd MMM yyyy HH:mm")}</TableCell>
                  <TableCell><Badge variant="outline" className={statusColors[a.status] ?? ""}>{a.status}</Badge></TableCell>
                  <TableCell className="text-sm">{a.truck_plate ?? "—"}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" title="Download PDF" onClick={() => downloadAppointmentPdf(a, customerName ?? "Depot")}>
                      <FileDown className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Appointment</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.appointment_type} onValueChange={(v) => set("appointment_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="drop_off">Drop Off</SelectItem>
                    <SelectItem value="pick_up">Pick Up</SelectItem>
                    <SelectItem value="inspection">Inspection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Scheduled Date/Time *</Label>
                <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => set("scheduled_at", e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Container Number</Label>
              <Input value={form.container_number} onChange={(e) => set("container_number", e.target.value)} placeholder="e.g. MSKU1234567" />
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
                <Label>Driver License</Label>
                <Input value={form.driver_license} onChange={(e) => set("driver_license", e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
            </div>
            <Button type="submit" className="w-full" disabled={create.isPending}>Create Appointment</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
