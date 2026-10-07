import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pause, Play, Pencil, X, History, ChevronDown, ChevronRight, Repeat } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { RecurringTransferDialog } from "./RecurringTransferDialog";
import { RecurringRunHistorySheet } from "./RecurringRunHistorySheet";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { nextOccurrences } from "@/lib/recurring-schedule";

export function RecurringTransfersTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isAdmin } = useUserStaffRole();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [historyRule, setHistoryRule] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: rules, isLoading } = useQuery({
    queryKey: ["recurring-transfers"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("recurring_transfers")
        .select("*, from_account:financial_accounts!from_account_id(name), to_account:financial_accounts!to_account_id(name)")
        .order("next_run_at");
      if (error) throw error;
      return data;
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await (supabase as any).from("recurring_transfers").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["recurring-transfers"] });
      toast({ title: `Schedule ${v.status}` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    return (rules ?? []).filter((r: any) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rules, statusFilter, search]);

  const toggleExpand = (id: string) => {
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Schedules auto-post hourly. Pause to skip upcoming runs without losing the rule.</p>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="mr-1 h-4 w-4" />New Schedule</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="ended">Ended</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} of {rules?.length ?? 0}</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>From → To</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !filtered.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-10">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Repeat className="h-8 w-8 opacity-40" />
                    <p className="text-sm">{rules?.length ? "No schedules match your filter." : "No recurring schedules yet."}</p>
                    {!rules?.length && <Button size="sm" variant="outline" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="mr-1 h-4 w-4" />Create your first schedule</Button>}
                  </div>
                </TableCell></TableRow>
              ) : filtered.map((r: any) => {
                const isOpen = expanded.has(r.id);
                const upcoming = nextOccurrences(new Date(r.next_run_at), r.frequency, r.interval_count, 5, r.end_date ? new Date(r.end_date) : null);
                const busy = setStatus.isPending && setStatus.variables?.id === r.id;
                return (
                  <Fragment key={r.id}>
                    <TableRow>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => toggleExpand(r.id)}>
                          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">
                        <button className="text-left hover:underline" onClick={() => setHistoryRule(r)}>{r.name}</button>
                      </TableCell>
                      <TableCell className="text-sm">{r.from_account?.name} → {r.to_account?.name}</TableCell>
                      <TableCell className="text-right font-mono">{Number(r.amount).toFixed(2)}</TableCell>
                      <TableCell className="text-xs capitalize">every {r.interval_count} {r.frequency}</TableCell>
                      <TableCell className="text-xs">{format(new Date(r.next_run_at), "yyyy-MM-dd")}</TableCell>
                      <TableCell className="text-xs">{r.last_run_at ? format(new Date(r.last_run_at), "yyyy-MM-dd") : "—"}</TableCell>
                      <TableCell>
                        {r.status === "active" && <Badge variant="secondary" className="bg-success/15 text-success">active</Badge>}
                        {r.status === "paused" && <Badge variant="secondary" className="bg-warning/15 text-warning">paused</Badge>}
                        {r.status === "ended" && <Badge variant="outline">ended</Badge>}
                      </TableCell>
                      <TableCell className="space-x-1 whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setHistoryRule(r)} title="History"><History className="h-3 w-3" /></Button>
                        {r.status === "active" && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus.mutate({ id: r.id, status: "paused" })} title="Pause"><Pause className="h-3 w-3" /></Button>
                        )}
                        {r.status === "paused" && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus.mutate({ id: r.id, status: "active" })} title="Resume"><Play className="h-3 w-3" /></Button>
                        )}
                        {r.status !== "ended" && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }} title="Edit"><Pencil className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (confirm("End this schedule? It will no longer auto-post.")) setStatus.mutate({ id: r.id, status: "ended" }); }} title="End"><X className="h-3 w-3" /></Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={9} className="py-2">
                          <div className="text-xs">
                            <span className="font-semibold mr-2">Next 5 runs:</span>
                            {upcoming.length === 0 ? <span className="text-muted-foreground">no upcoming runs</span> : upcoming.map((d, i) => (
                              <Badge key={i} variant="outline" className={`mr-1 ${r.status === "paused" ? "opacity-50" : ""}`}>
                                {format(d, "MMM d")}
                              </Badge>
                            ))}
                            {r.end_date && <span className="ml-3 text-muted-foreground">ends {format(new Date(r.end_date), "yyyy-MM-dd")}</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RecurringTransferDialog open={open} onOpenChange={setOpen} initial={editing} />
      <RecurringRunHistorySheet rule={historyRule} onOpenChange={(v) => { if (!v) setHistoryRule(null); }} canRunNow={isAdmin} />
    </div>
  );
}
