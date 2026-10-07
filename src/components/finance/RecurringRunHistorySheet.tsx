import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Link } from "@/lib/router";
import { Play, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { nextOccurrences } from "@/lib/recurring-schedule";

type Props = { rule: any | null; onOpenChange: (v: boolean) => void; canRunNow: boolean };

export function RecurringRunHistorySheet({ rule, onOpenChange, canRunNow }: Props) {
  const open = !!rule;
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: runs, isLoading } = useQuery({
    queryKey: ["recurring-runs", rule?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("recurring_transfer_runs")
        .select("*, transfer:inter_account_transfers(id, transfer_number)")
        .eq("recurring_transfer_id", rule.id)
        .order("ran_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const { error, data } = await (supabase as any).rpc("run_recurring_transfer_now", { _id: rule.id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Posted now", description: "An occurrence was posted and next run advanced." });
      qc.invalidateQueries({ queryKey: ["recurring-runs", rule.id] });
      qc.invalidateQueries({ queryKey: ["recurring-transfers"] });
    },
    onError: (e: any) => toast({ title: "Could not run", description: e.message, variant: "destructive" }),
  });

  const previewRuns = rule
    ? nextOccurrences(new Date(rule.next_run_at), rule.frequency, rule.interval_count, 5, rule.end_date ? new Date(rule.end_date) : null)
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {rule && (
          <>
            <SheetHeader>
              <SheetTitle>{rule.name}</SheetTitle>
              <SheetDescription>
                Every {rule.interval_count} {rule.frequency} · {Number(rule.amount).toFixed(2)} {rule.from_account?.name} → {rule.to_account?.name}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Upcoming Runs</h4>
                {canRunNow && rule.status === "active" && (
                  <Button size="sm" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
                    <Play className="mr-1 h-3 w-3" />Run now
                  </Button>
                )}
              </div>
              <div className="rounded border divide-y">
                {previewRuns.length === 0 && <p className="p-3 text-xs text-muted-foreground">No upcoming runs.</p>}
                {previewRuns.map((d, i) => (
                  <div key={i} className={`flex items-center justify-between p-2 text-sm ${rule.status === "paused" ? "opacity-50" : ""}`}>
                    <span>{format(d, "EEE, dd MMM yyyy")}</span>
                    {rule.status === "paused" && <Badge variant="outline" className="text-xs">paused</Badge>}
                    {rule.status === "active" && i === 0 && <Badge variant="secondary" className="bg-primary/15 text-primary text-xs">next</Badge>}
                  </div>
                ))}
              </div>
            </div>

            <Separator className="my-6" />

            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Run History</h4>
              {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
              : !runs?.length ? <p className="text-sm text-muted-foreground">No runs yet.</p>
              : (
                <div className="rounded border divide-y">
                  {runs.map((r: any) => (
                    <div key={r.id} className="p-2 text-sm flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs">{format(new Date(r.ran_at), "yyyy-MM-dd HH:mm")}</span>
                          {r.status === "posted" && <Badge variant="secondary" className="bg-success/15 text-success text-xs">posted</Badge>}
                          {r.status === "failed" && <Badge variant="destructive" className="text-xs">failed</Badge>}
                          {r.status === "skipped" && <Badge variant="outline" className="text-xs">skipped</Badge>}
                        </div>
                        {r.error_message && <p className="text-xs text-destructive truncate">{r.error_message}</p>}
                      </div>
                      {r.transfer?.id && (
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/finance/transfers`}>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
