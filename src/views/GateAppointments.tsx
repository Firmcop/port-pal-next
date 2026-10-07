import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, CalendarClock, Search, FileDown } from "lucide-react";
import { downloadAppointmentPdf } from "@/lib/appointment-pdf";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  scheduled: "bg-info/15 text-info border-info/30",
  confirmed: "bg-info/15 text-info border-info/30",
  in_progress: "bg-warning/15 text-warning border-warning/30",
  completed: "bg-success/15 text-success border-success/30",
  cancelled: "bg-gray-500/15 text-gray-700 border-gray-300",
  no_show: "bg-destructive/15 text-destructive border-destructive/30",
};

function generateAppointmentNumber() {
  const d = new Date();
  return `APT-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}

export default function GateAppointments() {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: appointments, isLoading } = useQuery({
    queryKey: ["gate-appointments", search, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("gate_appointments")
        .select("*")
        .order("scheduled_at", { ascending: false });
      if (search) q = q.or(`container_number.ilike.%${search}%,appointment_number.ilike.%${search}%,truck_plate.ilike.%${search}%`);
      if (statusFilter !== "all") q = q.eq("status", statusFilter as any);
      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: containers } = useQuery({
    queryKey: ["containers-for-gate"],
    queryFn: async () => {
      const { data, error } = await supabase.from("containers").select("id, container_number").order("container_number");
      if (error) throw error;
      return data;
    },
  });

  const { data: trucksDrivers } = useQuery({
    queryKey: ["trucks-drivers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trucks_drivers").select("*").eq("is_active", true).order("driver_name");
      if (error) throw error;
      return data;
    },
  });

  const createAppointment = useMutation({
    mutationFn: async (form: any) => {
      const { error } = await supabase.from("gate_appointments").insert({
        ...form,
        appointment_number: generateAppointmentNumber(),
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gate-appointments"] });
      toast({ title: "Appointment booked" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("gate_appointments").update({ status: status as any }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gate-appointments"] });
      toast({ title: "Status updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [form, setForm] = useState<any>({
    appointment_type: "gate_in",
    scheduled_at: "",
    container_number: "",
    container_id: "",
    truck_plate: "",
    driver_name: "",
    driver_license: "",
    shipping_line: "",
    notes: "",
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleTruckSelect = (truckId: string) => {
    const truck = trucksDrivers?.find((t) => t.id === truckId);
    if (truck) {
      setForm((f: any) => ({
        ...f,
        truck_plate: truck.truck_plate,
        driver_name: truck.driver_name,
        driver_license: truck.driver_license ?? "",
      }));
    }
  };

  const todayCount = appointments?.filter((a) => {
    const d = new Date(a.scheduled_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length ?? 0;

  const pendingCount = appointments?.filter((a) => a.status === "scheduled" || a.status === "confirmed").length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("nav.appointments")}</h1>
          <p className="text-muted-foreground">
            {todayCount} today · {pendingCount} pending
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" />Book Appointment</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Book Gate Appointment</DialogTitle></DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const payload = { ...form };
                if (!payload.container_id) delete payload.container_id;
                createAppointment.mutate(payload);
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={form.appointment_type} onValueChange={(v) => set("appointment_type", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gate_in">Gate In</SelectItem>
                      <SelectItem value="gate_out">Gate Out</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Scheduled At</Label>
                  <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => set("scheduled_at", e.target.value)} required />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Container Number</Label>
                  <Input placeholder="MSCU1234567" value={form.container_number} onChange={(e) => set("container_number", e.target.value.toUpperCase())} className="font-mono" />
                </div>
                <div className="space-y-2">
                  <Label>Link to Existing Container</Label>
                  <Select value={form.container_id} onValueChange={(v) => set("container_id", v)}>
                    <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                    <SelectContent>
                      {containers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.container_number}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Truck / Driver (from registry)</Label>
                <Select onValueChange={handleTruckSelect}>
                  <SelectTrigger><SelectValue placeholder="Select registered truck/driver" /></SelectTrigger>
                  <SelectContent>
                    {trucksDrivers?.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.truck_plate} — {t.driver_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Truck Plate</Label>
                  <Input value={form.truck_plate} onChange={(e) => set("truck_plate", e.target.value.toUpperCase())} className="font-mono" />
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
                <Label>Shipping Line</Label>
                <Input value={form.shipping_line} onChange={(e) => set("shipping_line", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={createAppointment.isPending}>Book Appointment</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search appointment, container, or truck..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="no_show">No Show</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Appointment #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Truck</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={8} />
              ) : !appointments?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No appointments found</TableCell></TableRow>
              ) : (
                appointments.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-sm">{a.appointment_number}</TableCell>
                    <TableCell className="capitalize">{a.appointment_type.replace("_", " ")}</TableCell>
                    <TableCell className="text-sm">{a.scheduled_at && !isNaN(new Date(a.scheduled_at).getTime()) ? format(new Date(a.scheduled_at), "PPp") : "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{a.container_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{a.truck_plate ?? "—"}</TableCell>
                    <TableCell className="text-sm">{a.driver_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColors[a.status] ?? ""}>
                        {a.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        <Button size="sm" variant="ghost" title="Download PDF for driver" onClick={() => downloadAppointmentPdf(a)}>
                          <FileDown className="h-4 w-4" />
                        </Button>
                        {a.status === "scheduled" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: a.id, status: "confirmed" })}>
                              Confirm
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: a.id, status: "cancelled" })}>
                              Cancel
                            </Button>
                          </>
                        )}
                        {a.status === "confirmed" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: a.id, status: "in_progress" })}>
                            Start
                          </Button>
                        )}
                        {a.status === "in_progress" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: a.id, status: "completed" })}>
                            Complete
                          </Button>
                        )}
                      </div>
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
