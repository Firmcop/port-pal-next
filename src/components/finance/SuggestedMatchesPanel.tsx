import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Sparkles, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const CONFLICT_ACTIONS: Record<string, { label: string; action: string }> = {
  already_cleared: { label: "Use existing", action: "use_existing" },
  linked_other_recon: { label: "Detach & re-link", action: "detach_relink" },
  linked_to_other_reconciliation: { label: "Detach & re-link", action: "detach_relink" },
  date_out_of_window: { label: "Accept anyway", action: "accept_anyway" },
  date_outside_window: { label: "Accept anyway", action: "accept_anyway" },
  possible_duplicate_amount: { label: "Mark duplicate", action: "mark_duplicate" },
};

function conflictKey(c: string) {
  return c.toLowerCase().replace(/\s+/g, "_");
}

export function SuggestedMatchesPanel({ reconciliationId, disabled }: { reconciliationId: string; disabled?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["recon-suggestions", reconciliationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("suggest_reconciliation_matches", { _reconciliation_id: reconciliationId });
      if (error) throw error;
      return data;
    },
  });

  const matchOne = useMutation({
    mutationFn: async (txnId: string) => {
      const { data: line, error: le } = await (supabase as any)
        .from("bank_reconciliation_lines")
        .select("id")
        .eq("reconciliation_id", reconciliationId)
        .eq("transaction_id", txnId)
        .maybeSingle();
      if (le) throw le;
      if (line) {
        const { error } = await (supabase as any).rpc("bulk_clear_reconciliation_lines_v2", {
          _recon_id: reconciliationId,
          _line_ids: [line.id],
          _skip_conflicts: false,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recon-lines", reconciliationId] });
      qc.invalidateQueries({ queryKey: ["recon-suggestions", reconciliationId] });
      toast({ title: "Matched & cleared" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resolve = useMutation({
    mutationFn: async ({ txnId, action }: { txnId: string; action: string }) => {
      const { data: line, error: le } = await (supabase as any)
        .from("bank_reconciliation_lines")
        .select("id")
        .eq("reconciliation_id", reconciliationId)
        .eq("transaction_id", txnId)
        .maybeSingle();
      if (le) throw le;
      if (!line) throw new Error("No line found for this transaction");
      const { error } = await (supabase as any).rpc("resolve_reconciliation_conflict", {
        _line_id: line.id, _action: action, _note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recon-lines", reconciliationId] });
      qc.invalidateQueries({ queryKey: ["recon-suggestions", reconciliationId] });
      toast({ title: "Conflict resolved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const top = (data ?? []).slice(0, 8);

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Suggested Matches</CardTitle></CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : !top.length ? <p className="text-sm text-muted-foreground">No suggestions in window.</p>
        : top.map((s: any) => (
          <div key={s.candidate_transaction_id} className={`flex flex-wrap items-center justify-between gap-2 p-2 rounded text-sm border ${s.conflicts?.length ? "border-warning/40 bg-warning/5" : "border-transparent hover:bg-muted/50"}`}>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{s.transaction_number}</span>
                <span className="text-xs text-muted-foreground">{format(new Date(s.transaction_date), "yyyy-MM-dd")}</span>
                <Badge variant="outline" className="text-xs">score {s.score}</Badge>
                {s.conflicts?.map((c: string) => {
                  const meta = CONFLICT_ACTIONS[conflictKey(c)];
                  return (
                    <span key={c} className="inline-flex items-center gap-1">
                      <Badge variant="secondary" className="bg-warning/15 text-warning text-xs">
                        <AlertTriangle className="h-3 w-3 mr-1" />{c.replace(/_/g, " ")}
                      </Badge>
                      {meta && (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={disabled || resolve.isPending}
                          onClick={() => resolve.mutate({ txnId: s.candidate_transaction_id, action: meta.action })}>
                          <CheckCircle className="h-3 w-3 mr-1" />{meta.label}
                        </Button>
                      )}
                    </span>
                  );
                })}
              </div>
              <p className="truncate text-muted-foreground">{s.description}</p>
            </div>
            <div className="text-right text-xs font-mono whitespace-nowrap">
              {Number(s.debit_amount) > 0 ? `+${Number(s.debit_amount).toFixed(2)}` : `−${Number(s.credit_amount).toFixed(2)}`}
            </div>
            <Button size="sm" variant="outline" disabled={disabled || matchOne.isPending} onClick={() => matchOne.mutate(s.candidate_transaction_id)}>Match</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
