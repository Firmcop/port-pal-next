import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Activity, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, Star } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend,
} from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const RANGES: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };

export default function GateDashboard() {
  const [range, setRange] = useState<keyof typeof RANGES>("7d");
  const { from, to } = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - RANGES[range] * 86400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [range]);

  const { data, isLoading } = useQuery({
    queryKey: ["gate-dashboard", range],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gate_dashboard", { _from: from, _to: to } as any);
      if (error) throw error;
      return data as any;
    },
  });

  const k = data?.kpis ?? {};
  const series = (data?.series ?? []) as { d: string; gate_in: number; gate_out: number }[];
  const byBlock = (data?.by_block ?? []) as { name: string; value: number }[];
  const byOperator = (data?.by_operator ?? []) as { name: string; value: number }[];
  const gradeMix = (data?.grade_mix ?? []) as { name: string; value: number }[];
  const lowGrade = (data?.issues?.low_grade ?? []) as any[];
  const failedImports = (data?.issues?.recent_failed_imports ?? []) as any[];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" /> Gate Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">Gate activity, operator throughput and import issues.</p>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as any)}>
          <TabsList>
            {Object.keys(RANGES).map((r) => <TabsTrigger key={r} value={r}>{r}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={ArrowDownToLine} label="Gate-in" value={k.gate_in ?? 0} tone="success" />
        <Kpi icon={ArrowUpFromLine} label="Gate-out" value={k.gate_out ?? 0} />
        <Kpi icon={Star} label="Avg condition (4=A)" value={k.avg_grade ?? "—"} />
        <Kpi icon={AlertTriangle} label="Failed imports" value={k.failed_imports ?? 0} tone={k.failed_imports ? "destructive" : undefined} />
      </div>

      <Card>
        <CardHeader><CardTitle>Throughput</CardTitle></CardHeader>
        <CardContent className="h-72">
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <ResponsiveContainer>
              <AreaChart data={series}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="d" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="gate_in" stackId="1" stroke="hsl(var(--success))" fill="hsl(var(--success) / 0.3)" />
                <Area type="monotone" dataKey="gate_out" stackId="2" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Gate-in by yard block</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer>
              <BarChart data={byBlock}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Gate moves by operator</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer>
              <BarChart data={byOperator} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--accent))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Condition grade mix</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {gradeMix.length === 0 && <p className="text-sm text-muted-foreground">No EIRs in range.</p>}
          {gradeMix.map((g) => (
            <Badge key={g.name} variant="outline" className="text-sm">
              {g.name}: <strong className="ms-1">{g.value}</strong>
            </Badge>
          ))}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>EIRs flagged C/D</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>EIR</TableHead><TableHead>Container</TableHead><TableHead>Grade</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
              <TableBody>
                {lowGrade.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-sm">No issues 🎉</TableCell></TableRow>}
                {lowGrade.slice(0, 25).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.eir_number}</TableCell>
                    <TableCell className="font-mono text-xs">{r.container}</TableCell>
                    <TableCell><Badge variant="outline" className={r.grade === "D" ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-warning/10 text-warning border-warning/30"}>{r.grade}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.at ? new Date(r.at).toLocaleString() : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent failed imports</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Reason</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
              <TableBody>
                {failedImports.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground text-sm">No failed imports</TableCell></TableRow>}
                {failedImports.slice(0, 25).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.business_key}</TableCell>
                    <TableCell className="text-xs text-destructive">{r.message}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.at ? new Date(r.at).toLocaleString() : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: any; tone?: "success" | "destructive" }) {
  const color = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <Icon className={`h-4 w-4 ${color}`} />
        </div>
        <p className={`text-2xl font-bold mt-2 ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
