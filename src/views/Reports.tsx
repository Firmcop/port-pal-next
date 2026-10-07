import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getOrgCurrency } from "@/lib/app-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from "recharts";
import { Package, TrendingUp, Wrench, DollarSign, Truck, FileSpreadsheet, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LogisticsPnLReport } from "@/components/reports/LogisticsPnLReport";
import { formatMoney } from "@/lib/app-settings";
import { fetchAllContainersForExport, exportInventoryXlsx, exportInventoryPdf } from "@/lib/inventory-export";
import { useToast } from "@/hooks/use-toast";


const COLORS = [
  "hsl(215, 90%, 42%)", "hsl(142, 72%, 40%)", "hsl(38, 92%, 50%)",
  "hsl(0, 72%, 51%)", "hsl(280, 60%, 50%)", "hsl(180, 60%, 40%)",
];

function KpiCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

type Summary = {
  kpi: { total_containers: number; in_yard: number; avg_dwell_days: number; total_revenue: number; paid_revenue: number; work_orders_total: number; work_orders_completed: number };
  throughput: { date: string; gate_in: number; gate_out: number }[];
  status_dist: { name: string; value: number }[];
  category_dist: { name: string; value: number }[];
  yard_util: { block: string; used: number; capacity: number; pct: number }[];
  revenue_by_type: { name: string; value: number }[];
  revenue_by_status: { name: string; value: number }[];
  wo_status: { name: string; value: number }[];
  wo_priority: { name: string; value: number }[];
  grade_dist: { name: string; value: number }[];
  stock_owner: { name: string; total: number; available: number; damaged: number; in_repair: number; other: number }[];
  stock_line: { name: string; total: number; available: number; damaged: number; in_repair: number; other: number }[];
  stock_size_owner: { name: string; "20ft": number; "40ft": number; "45ft": number }[];
};

export default function Reports() {
  const { data } = useQuery({
    queryKey: ["report-summary", 14],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_summary", { _days: 14 });
      if (error) throw error;
      return data as unknown as Summary;
    },
  });

  const throughputData = data?.throughput ?? [];
  const statusData = data?.status_dist ?? [];
  const categoryData = data?.category_dist ?? [];
  const yardUtilData = data?.yard_util ?? [];
  const revenueByType = data?.revenue_by_type ?? [];
  const revenueByStatus = data?.revenue_by_status ?? [];
  const woByStatus = data?.wo_status ?? [];
  const woByPriority = data?.wo_priority ?? [];
  const gradeData = data?.grade_dist ?? [];
  const stockByOwner = data?.stock_owner ?? [];
  const stockByShippingLine = data?.stock_line ?? [];
  const stockBySizeOwner = data?.stock_size_owner ?? [];

  const kpi = data?.kpi;
  const totalRevenue = Number(kpi?.total_revenue ?? 0);
  const paidRevenue = Number(kpi?.paid_revenue ?? 0);
  const inYard = kpi?.in_yard ?? 0;
  const avgDwell = kpi?.avg_dwell_days ?? 0;
  const containers = kpi ? { length: kpi.total_containers } : null;
  const workOrders = kpi ? { length: kpi.work_orders_total, completed: kpi.work_orders_completed } : null;

  const { toast } = useToast();
  const [exporting, setExporting] = useState<null | "xlsx" | "pdf">(null);
  const handleExport = async (kind: "xlsx" | "pdf") => {
    try {
      setExporting(kind);
      toast({ title: "Preparing export…", description: "Fetching all inventory" });
      const all = await fetchAllContainersForExport();
      if (!all.length) {
        toast({ title: "No containers to export", variant: "destructive" });
        return;
      }
      if (kind === "xlsx") exportInventoryXlsx(all);
      else exportInventoryPdf(all);
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  const { t } = useTranslation("reports");
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExport("xlsx")} disabled={!!exporting}>
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            {exporting === "xlsx" ? "Exporting…" : "Inventory · Excel"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("pdf")} disabled={!!exporting}>
            <FileText className="h-4 w-4 mr-1" />
            {exporting === "pdf" ? "Exporting…" : "Inventory · PDF"}
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Package} label={t("kpi_total_containers")} value={containers?.length ?? 0} sub={t("kpi_in_yard", { count: inYard })} />
        <KpiCard icon={TrendingUp} label={t("kpi_avg_dwell")} value={`${avgDwell}${t("days_unit")}`} sub={t("kpi_avg_dwell_sub")} />
        <KpiCard icon={DollarSign} label={t("kpi_total_revenue")} value={formatMoney(totalRevenue)} sub={`${t("kpi_collected", { amount: formatMoney(paidRevenue) })} · ${getOrgCurrency()}`} />
        <KpiCard icon={Wrench} label={t("kpi_work_orders")} value={workOrders?.length ?? 0} sub={t("kpi_completed", { count: workOrders?.completed ?? 0 })} />
      </div>

      <Tabs defaultValue="throughput" className="space-y-4">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="throughput">{t("tab_throughput")}</TabsTrigger>
          <TabsTrigger value="stock">{t("tab_stock")}</TabsTrigger>
          <TabsTrigger value="yard">{t("tab_yard")}</TabsTrigger>
          <TabsTrigger value="revenue">{t("tab_revenue")}</TabsTrigger>
          <TabsTrigger value="mr">M&R</TabsTrigger>
          <TabsTrigger value="logistics"><Truck className="h-3 w-3 mr-1 inline" />Logistics</TabsTrigger>
        </TabsList>

        {/* ── Throughput ── */}
        <TabsContent value="throughput" className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Daily Gate In / Out (Last 14 Days)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={throughputData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
                  <Legend />
                  <Area type="monotone" dataKey="gate_in" name="Gate In" stroke="hsl(142, 72%, 40%)" fill="hsl(142, 72%, 40%)" fillOpacity={0.2} strokeWidth={2} />
                  <Area type="monotone" dataKey="gate_out" name="Gate Out" stroke="hsl(0, 72%, 51%)" fill="hsl(0, 72%, 51%)" fillOpacity={0.2} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Containers by Status</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" outerRadius={90} innerRadius={50} dataKey="value" label={({ name, value }) => `${name}: ${value}`} paddingAngle={2}>
                      {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Containers by Category</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={categoryData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="hsl(215, 90%, 42%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Stock by Owner / Shipping Line ── */}
        <TabsContent value="stock" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Containers by Owner</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(280, stockByOwner.length * 40)}>
                  <BarChart data={stockByOwner} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="available" name="Available" stackId="a" fill="hsl(142, 72%, 40%)" />
                    <Bar dataKey="damaged" name="Damaged" stackId="a" fill="hsl(0, 72%, 51%)" />
                    <Bar dataKey="in_repair" name="In Repair" stackId="a" fill="hsl(38, 92%, 50%)" />
                    <Bar dataKey="other" name="Other" stackId="a" fill="hsl(215, 90%, 42%)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Containers by Shipping Line</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(280, stockByShippingLine.length * 40)}>
                  <BarChart data={stockByShippingLine} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="available" name="Available" stackId="a" fill="hsl(142, 72%, 40%)" />
                    <Bar dataKey="damaged" name="Damaged" stackId="a" fill="hsl(0, 72%, 51%)" />
                    <Bar dataKey="in_repair" name="In Repair" stackId="a" fill="hsl(38, 92%, 50%)" />
                    <Bar dataKey="other" name="Other" stackId="a" fill="hsl(215, 90%, 42%)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Container Sizes by Owner</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={Math.max(280, stockBySizeOwner.length * 40)}>
                <BarChart data={stockBySizeOwner} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                  <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="20ft" name="20'" stackId="a" fill="hsl(215, 90%, 42%)" />
                  <Bar dataKey="40ft" name="40'" stackId="a" fill="hsl(142, 72%, 40%)" />
                  <Bar dataKey="45ft" name="45'" stackId="a" fill="hsl(38, 92%, 50%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          {/* Summary table */}
          <Card>
            <CardHeader><CardTitle className="text-base">Stock Summary by Owner</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Owner</th>
                      <th className="text-right p-3 font-medium">Total</th>
                      <th className="text-right p-3 font-medium">Available</th>
                      <th className="text-right p-3 font-medium">Damaged</th>
                      <th className="text-right p-3 font-medium">In Repair</th>
                      <th className="text-right p-3 font-medium">Other</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockByOwner.map((row) => (
                      <tr key={row.name} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-3 font-medium">{row.name}</td>
                        <td className="p-3 text-right">{row.total}</td>
                        <td className="p-3 text-right text-success">{row.available}</td>
                        <td className="p-3 text-right text-destructive">{row.damaged}</td>
                        <td className="p-3 text-right text-warning">{row.in_repair}</td>
                        <td className="p-3 text-right text-muted-foreground">{row.other}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="yard" className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Yard Block Utilization</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={yardUtilData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="block" type="category" width={80} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number, name: string) => [v, name === "used" ? "Used" : "Capacity"]} />
                  <Legend />
                  <Bar dataKey="capacity" name="Capacity" fill="hsl(220, 15%, 88%)" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="used" name="Used" fill="hsl(215, 90%, 42%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Utilization Percentage by Block</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={yardUtilData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="block" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => [`${v}%`, "Utilization"]} />
                  <Bar dataKey="pct" name="Utilization %" radius={[4, 4, 0, 0]}>
                    {yardUtilData.map((entry, i) => (
                      <Cell key={i} fill={entry.pct > 80 ? "hsl(0, 72%, 51%)" : entry.pct > 50 ? "hsl(38, 92%, 50%)" : "hsl(142, 72%, 40%)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Revenue ── */}
        <TabsContent value="revenue" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Revenue by Charge Type</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={revenueByType} cx="50%" cy="50%" outerRadius={90} innerRadius={50} dataKey="value" label={({ name, value }) => `${name}: ${formatMoney(value as number)}`} paddingAngle={2}>
                      {revenueByType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatMoney(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Revenue by Invoice Status</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={revenueByStatus}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(v) => formatMoney(v)} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v: number) => formatMoney(v)} />
                    <Bar dataKey="value" name="Amount" fill="hsl(142, 72%, 40%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── M&R ── */}
        <TabsContent value="mr" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="text-base">Work Orders by Status</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={woByStatus} cx="50%" cy="50%" outerRadius={80} innerRadius={40} dataKey="value" label={({ name, value }) => `${name}: ${value}`} paddingAngle={2}>
                      {woByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Work Orders by Priority</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={woByPriority}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]}>
                      {woByPriority.map((entry, i) => (
                        <Cell key={i} fill={
                          entry.name === "urgent" ? "hsl(0, 72%, 51%)" :
                          entry.name === "high" ? "hsl(38, 92%, 50%)" :
                          entry.name === "medium" ? "hsl(215, 90%, 42%)" :
"hsl(142, 72%, 40%)"
                        } />
                      ))} 
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Inspection Grades</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={gradeData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" name="Inspections" fill="hsl(280, 60%, 50%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="logistics" className="space-y-6">
          <LogisticsPnLReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}
