import { useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RefreshCw, ChevronDown, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import {
  LEGACY_ORG_ID,
  fetchVisibleRowCounts,
  syncFinanceData,
} from "@/lib/finance-diagnostics";

type Props = {
  queryKeys: string[];
};

function formatTime(ts: number | undefined) {
  if (!ts) return "never";
  return new Date(ts).toLocaleTimeString();
}

export function FinanceDataStatus({ queryKeys }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const org = useOrganization();
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<{ ok: boolean; durationMs: number; error?: string } | null>(null);

  // Subscribe to status of each query
  const states = useQueries({
    queries: queryKeys.map((k) => ({
      queryKey: [k, "__status__"],
      queryFn: async () => null,
      enabled: false,
    })),
  });
  // Re-read fresh state on every render
  const queryStates = queryKeys.map((k) => qc.getQueryState([k]));

  const diagnostics = useQueries({
    queries: [
      {
        queryKey: ["finance-diagnostics-row-counts"],
        queryFn: fetchVisibleRowCounts,
        enabled: open,
        staleTime: 30_000,
      },
    ],
  })[0];

  const handleSync = async () => {
    setSyncing(true);
    const result = await syncFinanceData(qc);
    setSyncing(false);
    setLastSync(result);
    toast({
      title: result.ok ? "Finance data refreshed" : "Sync failed",
      description: result.ok
        ? `Refetched ${queryKeys.length} dataset(s) in ${result.durationMs}ms`
        : result.error,
      variant: result.ok ? "default" : "destructive",
    });
    if (open) diagnostics.refetch();
  };

  const onLegacyOrg = org.organizationId === LEGACY_ORG_ID;

  return (
    <Card className="border-dashed">
      <CardContent className="py-3 space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Active org:</span>
            <Badge variant={onLegacyOrg ? "default" : "secondary"}>
              {org.organizationName ?? "—"}
            </Badge>
            <code className="text-xs text-muted-foreground">{org.organizationId ?? "—"}</code>
            {!onLegacyOrg && (
              <span className="text-xs text-warning">
                Not legacy org — sign out & back in if you just switched.
              </span>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Sync Finance Data
          </Button>
        </div>

        <div className="flex flex-wrap gap-3">
          {queryKeys.map((k, i) => {
            const s = queryStates[i];
            const status = s?.fetchStatus === "fetching" ? "fetching" : s?.status ?? "idle";
            const icon =
              status === "error" ? <AlertCircle className="h-3 w-3" /> :
              status === "fetching" ? <Loader2 className="h-3 w-3 animate-spin" /> :
              status === "success" ? <CheckCircle2 className="h-3 w-3" /> : null;
            const variant: any =
              status === "error" ? "destructive" :
              status === "success" ? "default" : "secondary";
            return (
              <div key={k} className="flex items-center gap-2 text-xs">
                <Badge variant={variant} className="gap-1">{icon}{k}</Badge>
                <span className="text-muted-foreground">last fetch: {formatTime(s?.dataUpdatedAt)}</span>
                {s?.error && (
                  <span className="text-destructive">{(s.error as any)?.message ?? String(s.error)}</span>
                )}
              </div>
            );
          })}
        </div>

        {lastSync && !lastSync.ok && (
          <div className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> Last sync error: {lastSync.error}
          </div>
        )}

        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
              <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${open ? "rotate-180" : ""}`} />
              Run diagnostics
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {diagnostics.isFetching ? (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Counting rows visible to your role…
              </div>
            ) : diagnostics.data ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {(["gl_accounts","accounting_transactions","invoices","purchase_orders"] as const).map((t) => (
                  <div key={t} className="border rounded p-2">
                    <div className="text-muted-foreground">{t}</div>
                    <div className="font-mono text-base">{diagnostics.data?.[t] ?? "—"}</div>
                  </div>
                ))}
                {diagnostics.data.error && (
                  <div className="col-span-full text-destructive">{diagnostics.data.error}</div>
                )}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground mt-2">
              If counts are 0 here too, your account isn't scoped to the org that owns this data —
              sign out and back in after any membership change.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
