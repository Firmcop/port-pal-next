import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Money } from "@/components/Money";
import { formatMoney } from "@/lib/app-settings";

const COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#dc2626", "#0891b2"];

const SERVICE_LINES = [
  { key: "storage", label: "Storage" },
  { key: "handling", label: "Handling" },
  { key: "damage_repair", label: "Damage Repairs" },
  { key: "repatriation", label: "Repatriation" },
  { key: "container_sale", label: "Container Sales" },
  { key: "conversion", label: "Conversions" },
  { key: "customer_payment", label: "Customer Payments" },
  { key: "vendor_payment", label: "Vendor Payments" },
  { key: "repatriation_cost", label: "Repatriation Costs" },
];

export default function FinancialSummary() {
  const { data: txns } = useQuery({
    queryKey: ["accounting-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounting_transactions").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: conversions } = useQuery({
    queryKey: ["conversions-all-profitability"],
    queryFn: async () => {
      const { data, error } = await supabase.from("container_conversions").select("id, conversion_number, status, quoted_price, actual_cost, currency").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: sales } = useQuery({
    queryKey: ["container-sales-profitability"],
    queryFn: async () => {
      const { data, error } = await supabase.from("container_sales").select("conversion_id, selling_price").not("conversion_id", "is", null);
      if (error) throw error;
      return data;
    },
  });

  const { data: materials } = useQuery({
    queryKey: ["conversion-materials-profitability"],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversion_materials").select("conversion_id, total_cost");
      if (error) throw error;
      return data;
    },
  });

  const { data: labour } = useQuery({
    queryKey: ["conversion-labour-profitability"],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversion_labour").select("conversion_id, total_cost");
      if (error) throw error;
      return data;
    },
  });

  const { data: services } = useQuery({
    queryKey: ["conversion-services-profitability"],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversion_services").select("conversion_id, cost");
      if (error) throw error;
      return data;
    },
  });

  const { data: vendorPayments } = useQuery({
    queryKey: ["vendor-payments-profitability"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendor_payments").select("conversion_id, amount").not("conversion_id", "is", null);
      if (error) throw error;
      return data;
    },
  });

  const stats = useMemo(() => {
    if (!txns?.length) return { revenue: 0, cogs: 0, expenses: 0, gross: 0, net: 0, byCategory: [], byType: [] };
    const revenue = txns.filter((t: any) => t.account_type === "revenue").reduce((s: number, t: any) => s + Number(t.credit_amount), 0);
    const cogs = txns.filter((t: any) => t.account_type === "cost_of_goods").reduce((s: number, t: any) => s + Number(t.debit_amount), 0);
    const expenses = txns.filter((t: any) => t.account_type === "expense").reduce((s: number, t: any) => s + Number(t.debit_amount), 0);

    const catMap: Record<string, number> = {};
    txns.forEach((t: any) => {
      const v = Number(t.credit_amount) - Number(t.debit_amount);
      catMap[t.category] = (catMap[t.category] ?? 0) + Math.abs(v);
    });
    const byCategory = Object.entries(catMap).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));

    const typeMap: Record<string, number> = {};
    txns.forEach((t: any) => {
      const v = Math.max(Number(t.debit_amount), Number(t.credit_amount));
      typeMap[t.account_type] = (typeMap[t.account_type] ?? 0) + v;
    });
    const byType = Object.entries(typeMap).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));

    return { revenue, cogs, expenses, gross: revenue - cogs, net: revenue - cogs - expenses, byCategory, byType };
  }, [txns]);

  // Revenue by service line
  const serviceLineData = useMemo(() => {
    if (!txns?.length) return [];
    const lineMap: Record<string, { revenue: number; cost: number }> = {};
    txns.forEach((t: any) => {
      const cat = t.category || "other";
      if (!lineMap[cat]) lineMap[cat] = { revenue: 0, cost: 0 };
      if (t.account_type === "revenue") {
        lineMap[cat].revenue += Number(t.credit_amount);
      } else {
        lineMap[cat].cost += Number(t.debit_amount);
      }
    });
    return SERVICE_LINES
      .map(sl => ({
        name: sl.label,
        revenue: lineMap[sl.key]?.revenue || 0,
        cost: lineMap[sl.key]?.cost || 0,
        profit: (lineMap[sl.key]?.revenue || 0) - (lineMap[sl.key]?.cost || 0),
      }))
      .filter(sl => sl.revenue > 0 || sl.cost > 0);
  }, [txns]);

  // Project profitability
  const projectProfitability = useMemo(() => {
    if (!conversions?.length) return [];
    return conversions.map((conv: any) => {
      const revenue = (sales ?? [])
        .filter((s: any) => s.conversion_id === conv.id)
        .reduce((sum: number, s: any) => sum + Number(s.selling_price), 0) || Number(conv.quoted_price || 0);
      const materialCost = (materials ?? [])
        .filter((m: any) => m.conversion_id === conv.id)
        .reduce((sum: number, m: any) => sum + Number(m.total_cost), 0);
      const labourCost = (labour ?? [])
        .filter((l: any) => l.conversion_id === conv.id)
        .reduce((sum: number, l: any) => sum + Number(l.total_cost), 0);
      const serviceCost = (services ?? [])
        .filter((s: any) => s.conversion_id === conv.id)
        .reduce((sum: number, s: any) => sum + Number(s.cost), 0);
      const vendorCost = (vendorPayments ?? [])
        .filter((vp: any) => vp.conversion_id === conv.id)
        .reduce((sum: number, vp: any) => sum + Number(vp.amount), 0);
      const totalCost = materialCost + labourCost + serviceCost + vendorCost;
      const profit = revenue - totalCost;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      return { id: conv.id, number: conv.conversion_number, status: conv.status, revenue, materialCost, labourCost, serviceCost, vendorCost, totalCost, profit, margin };
    }).filter((p: any) => p.revenue > 0 || p.totalCost > 0);
  }, [conversions, sales, materials, labour, services, vendorPayments]);

  const kpis = [
    { label: "Total Revenue", value: stats.revenue, icon: DollarSign, color: "text-success" },
    { label: "COGS", value: stats.cogs, icon: TrendingDown, color: "text-warning" },
    { label: "Gross Margin", value: stats.gross, icon: TrendingUp, color: "text-info" },
    { label: "Net Income", value: stats.net, icon: BarChart3, color: stats.net >= 0 ? "text-success" : "text-destructive" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Financial Summary</h1>
        <p className="text-muted-foreground">Overview of revenue, costs, margins & project profitability</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <k.icon className={`h-8 w-8 ${k.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-xl font-bold"><Money amount={k.value} /></p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue by Category</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {stats.byCategory.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.byCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {stats.byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatMoney(v)} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="flex items-center justify-center h-full text-muted-foreground">No data</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">By Account Type</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {stats.byType.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.byType}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => formatMoney(v)} />
                  <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="flex items-center justify-center h-full text-muted-foreground">No data</div>}
          </CardContent>
        </Card>
      </div>

      {/* Revenue by Service Line */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue by Service Line</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service Line</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!serviceLineData.length ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No transaction data</TableCell></TableRow>
              ) : serviceLineData.map((sl) => (
                <TableRow key={sl.name}>
                  <TableCell className="font-medium">{sl.name}</TableCell>
                  <TableCell className="text-right font-mono text-sm"><Money amount={sl.revenue} /></TableCell>
                  <TableCell className="text-right font-mono text-sm"><Money amount={sl.cost} /></TableCell>
                  <TableCell className={`text-right font-mono text-sm font-bold ${sl.profit >= 0 ? "text-success" : "text-destructive"}`}>
                    <Money amount={sl.profit} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Project Profitability */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project Profitability</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Materials</TableHead>
                <TableHead className="text-right">Labour</TableHead>
                <TableHead className="text-right">Services</TableHead>
                <TableHead className="text-right">Vendor Payments</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!projectProfitability.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No project data</TableCell></TableRow>
              ) : projectProfitability.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-sm font-medium">{p.number}</TableCell>
                  <TableCell className="text-sm capitalize">{p.status.replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-right font-mono text-sm"><Money amount={p.revenue} /></TableCell>
                  <TableCell className="text-right font-mono text-sm"><Money amount={p.materialCost} /></TableCell>
                  <TableCell className="text-right font-mono text-sm"><Money amount={p.labourCost} /></TableCell>
                  <TableCell className="text-right font-mono text-sm"><Money amount={p.serviceCost} /></TableCell>
                  <TableCell className="text-right font-mono text-sm"><Money amount={p.vendorCost} /></TableCell>
                  <TableCell className={`text-right font-mono text-sm font-bold ${p.profit >= 0 ? "text-success" : "text-destructive"}`}>
                    <Money amount={p.profit} />
                  </TableCell>
                  <TableCell className={`text-right font-mono text-sm ${p.margin >= 0 ? "text-success" : "text-destructive"}`}>
                    {p.margin.toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
