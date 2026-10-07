import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListChecks, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const statusVariant: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-warning/15 text-warning",
  done: "bg-success/15 text-success",
  skipped: "bg-destructive/15 text-destructive",
};

export default function PeriodClose() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [periodId, setPeriodId] = useState<string>("");

  const { data: periods } = useQuery({
    queryKey: ["fiscal-periods-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_periods" as any).select("id,year,month,status").order("year", { ascending: false }).order("month");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ["pcc", periodId],
    enabled: !!periodId,
    queryFn: async () => {
      const { data, error } = await supabase.from("period_close_checklist" as any).select("*").eq("period_id", periodId).order("sequence");
      if (error) throw error;
      return data as any[];
    },
  });

  const seed = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("seed_close_checklist" as any, { _period_id: periodId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pcc", periodId] }); toast({ title: "Checklist seeded" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setItemStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("period_close_checklist" as any).update({ status, completed_at: status === "done" ? new Date().toISOString() : null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pcc", periodId] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ListChecks className="h-6 w-6" />Period Close</h1>
          <p className="text-muted-foreground">Run through the period-end checklist before closing.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={periodId} onValueChange={setPeriodId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select period" /></SelectTrigger>
            <SelectContent>
              {periods?.map((p) => <SelectItem key={p.id} value={p.id}>{p.year}-{String(p.month).padStart(2, "0")} ({p.status})</SelectItem>)}
            </SelectContent>
          </Select>
          <Button disabled={!periodId || seed.isPending} onClick={() => seed.mutate()}><Sparkles className="h-4 w-4 mr-1" />Seed default tasks</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead className="w-12">#</TableHead><TableHead>Task</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {!periodId ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Select a period.</TableCell></TableRow>
              ) : isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
              ) : !items?.length ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No checklist. Seed default tasks above.</TableCell></TableRow>
              ) : items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-mono text-xs">{it.sequence}</TableCell>
                  <TableCell>{it.task}</TableCell>
                  <TableCell><Badge className={statusVariant[it.status]} variant="secondary">{it.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    {it.status !== "done" && <Button size="sm" variant="outline" onClick={() => setItemStatus.mutate({ id: it.id, status: "done" })}>Mark done</Button>}
                    {it.status === "pending" && <Button size="sm" variant="ghost" onClick={() => setItemStatus.mutate({ id: it.id, status: "in_progress" })}>Start</Button>}
                    {it.status === "done" && <Button size="sm" variant="ghost" onClick={() => setItemStatus.mutate({ id: it.id, status: "pending" })}>Reopen</Button>}
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
