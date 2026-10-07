import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { Waves } from "lucide-react";
import { fmtMoney } from "@/lib/finance-format";
import { format } from "date-fns";

export default function CashflowForecast() {
  const [weeks, setWeeks] = useState(13);

  const { data } = useQuery({
    queryKey: ["cashflow-forecast", weeks],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cashflow_forecast" as any, { _weeks: weeks });
      if (error) throw error;
      return (data as any[]).map((r) => ({
        ...r,
        label: format(new Date(r.week_start), "dd MMM"),
        expected_in: Number(r.expected_in),
        expected_out: Number(r.expected_out),
        net: Number(r.net),
      }));
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Waves className="h-6 w-6" />Cash Flow Forecast</h1>
          <p className="text-muted-foreground">Rolling weekly forecast from AR, AP, and recurring activity.</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="w-32"><Label>Weeks</Label><Input type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} /></div>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip formatter={(v: any) => fmtMoney(v)} />
              <Legend />
              <Line type="monotone" dataKey="expected_in" stroke="hsl(var(--success))" name="In" />
              <Line type="monotone" dataKey="expected_out" stroke="hsl(var(--destructive))" name="Out" />
              <Line type="monotone" dataKey="net" stroke="hsl(var(--primary))" name="Net" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week of</TableHead>
                <TableHead className="text-right">Expected In</TableHead>
                <TableHead className="text-right">Expected Out</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((r: any) => (
                <TableRow key={r.week_start}>
                  <TableCell className="font-mono text-xs">{r.label}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.expected_in)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.expected_out)}</TableCell>
                  <TableCell className={`text-right font-mono ${r.net < 0 ? "text-destructive" : "text-success"}`}>{fmtMoney(r.net)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
