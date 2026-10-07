import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarRange, Lock, Unlock, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const statusClass: Record<string, string> = {
  open: "bg-success/15 text-success",
  closed: "bg-warning/15 text-warning",
  locked: "bg-destructive/15 text-destructive",
};

export default function FiscalPeriods() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [year, setYear] = useState<number>(new Date().getFullYear());

  const { data: periods } = useQuery({
    queryKey: ["fiscal-periods"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_periods" as any).select("*").order("year", { ascending: false }).order("month");
      if (error) throw error;
      return data as any[];
    },
  });

  const openYear = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("open_fiscal_year" as any, { _year: year });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fiscal-periods"] }); toast({ title: `Year ${year} opened` }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.rpc("set_period_status" as any, { _period_id: id, _status: status });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fiscal-periods"] }); toast({ title: "Period updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarRange className="h-6 w-6" />Fiscal Periods</h1>
          <p className="text-muted-foreground">Manage open / closed / locked accounting periods.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="number" className="w-24" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          <Button onClick={() => openYear.mutate()} disabled={openYear.isPending}>Open year</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!periods?.length ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No periods. Open a fiscal year above.</TableCell></TableRow>
              ) : periods.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono">{p.year}-{String(p.month).padStart(2, "0")}</TableCell>
                  <TableCell className="text-xs">{p.start_date}</TableCell>
                  <TableCell className="text-xs">{p.end_date}</TableCell>
                  <TableCell><Badge className={statusClass[p.status] ?? ""} variant="secondary">{p.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    {p.status !== "open" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: p.id, status: "open" })}><Unlock className="h-3 w-3 mr-1" />Reopen</Button>}
                    {p.status === "open" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: p.id, status: "closed" })}><CheckCircle2 className="h-3 w-3 mr-1" />Close</Button>}
                    {p.status !== "locked" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: p.id, status: "locked" })}><Lock className="h-3 w-3 mr-1" />Lock</Button>}
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
