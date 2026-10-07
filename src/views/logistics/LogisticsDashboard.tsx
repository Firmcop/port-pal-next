import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Truck, Package, TrendingUp, AlertTriangle } from "lucide-react";

export default function LogisticsDashboard() {
  const { data: kpis } = useQuery({
    queryKey: ["logistics-dashboard"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [trips, orders, pnl] = await Promise.all([
        supabase.from("logistics_trips").select("id,status,trip_date").gte("trip_date", today.slice(0, 8) + "01"),
        supabase.from("logistics_transport_orders").select("id,status,quoted_price"),
        supabase.from("logistics_trip_pnl").select("revenue,total_cost,gross_margin,margin_pct"),
      ]);
      const tripsToday = (trips.data ?? []).filter((t: any) => t.trip_date === today).length;
      const inTransit = (trips.data ?? []).filter((t: any) => t.status === "in_transit").length;
      const openOrders = (orders.data ?? []).filter((o: any) =>
        ["draft", "confirmed", "assigned", "in_transit"].includes(o.status)
      ).length;
      const revenue = (pnl.data ?? []).reduce((s: number, r: any) => s + Number(r.revenue || 0), 0);
      const cost = (pnl.data ?? []).reduce((s: number, r: any) => s + Number(r.total_cost || 0), 0);
      const margin = revenue - cost;
      const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
      const lossTrips = (pnl.data ?? []).filter((r: any) => Number(r.gross_margin) < 0).length;
      return { tripsToday, inTransit, openOrders, revenue, cost, margin, marginPct, lossTrips };
    },
  });

  const k = kpis ?? { tripsToday: 0, inTransit: 0, openOrders: 0, revenue: 0, cost: 0, margin: 0, marginPct: 0, lossTrips: 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Truck className="h-6 w-6" />Logistics Dashboard</h1>
        <p className="text-muted-foreground">Operational overview of trips, orders and trip P&amp;L</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-muted-foreground"><Truck className="h-4 w-4" />Trips today</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{k.tripsToday}</div><div className="text-xs text-muted-foreground">{k.inTransit} in transit</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-muted-foreground"><Package className="h-4 w-4" />Open orders</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{k.openOrders}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-muted-foreground"><TrendingUp className="h-4 w-4" />Margin</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{k.margin.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            <div className="text-xs text-muted-foreground">{k.marginPct.toFixed(1)}% of {k.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-muted-foreground"><AlertTriangle className="h-4 w-4" />Loss-making trips</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{k.lossTrips}</div></CardContent>
        </Card>
      </div>
    </div>
  );
}
