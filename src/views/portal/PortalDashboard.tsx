import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Box, FileKey, Receipt, CalendarClock } from "lucide-react";
import { formatMoney } from "@/lib/app-settings";

export default function PortalDashboard() {
  const { customerId, customerName } = usePortalAuth();

  const { data: containerCount } = useQuery({
    queryKey: ["portal-container-count", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("containers")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: pendingReleases } = useQuery({
    queryKey: ["portal-pending-releases", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("release_instructions")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: pendingAppointments } = useQuery({
    queryKey: ["portal-pending-appointments", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("gate_appointments")
        .select("*", { count: "exact", head: true })
        .eq("status", "scheduled");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: outstandingInvoices } = useQuery({
    queryKey: ["portal-outstanding-invoices", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("total_amount, currency")
        .in("status", ["sent", "overdue"]);
      if (error) throw error;
      const by = new Map<string, number>();
      (data ?? []).forEach((i: any) => {
        const c = (i.currency || "").toUpperCase();
        by.set(c, (by.get(c) ?? 0) + Number(i.total_amount ?? 0));
      });
      return Array.from(by, ([currency, amount]) => ({ currency, amount }));
    },
  });

  const stats = [
    { label: "Containers in Depot", value: containerCount ?? 0, icon: Box, color: "text-info" },
    { label: "Pending Releases", value: pendingReleases ?? 0, icon: FileKey, color: "text-warning" },
    { label: "Upcoming Appointments", value: pendingAppointments ?? 0, icon: CalendarClock, color: "text-success" },
    {
      label: "Outstanding Balance",
      value: !outstandingInvoices?.length
        ? formatMoney(0)
        : outstandingInvoices
            .map((o) => formatMoney(o.amount, o.currency || undefined))
            .join(" + "),
      icon: Receipt,
      color: "text-destructive",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome, {customerName ?? "Customer"}</h1>
        <p className="text-muted-foreground">Your container depot overview</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold mt-1">{s.value}</p>
                </div>
                <s.icon className={`h-8 w-8 ${s.color} opacity-70`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Your recent container movements, releases, and billing updates will appear here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
