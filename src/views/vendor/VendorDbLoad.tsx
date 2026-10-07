import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Activity, AlertTriangle, Camera, RefreshCw, TrendingUp, Database, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type TopQuery = {
  queryid: number;
  query_text: string;
  calls: number;
  total_ms: number;
  mean_ms: number;
  max_ms: number;
  rows: number;
};

type Spike = {
  queryid: number;
  query_text: string;
  prev_total_ms: number;
  curr_total_ms: number;
  delta_total_ms: number;
  growth_factor: number;
  prev_calls: number;
  curr_calls: number;
  call_delta: number;
  prev_at: string;
  curr_at: string;
};

type Snapshot = {
  id: number;
  captured_at: string;
  queryid: number;
  query_text: string;
  calls: number;
  total_ms: number;
  mean_ms: number;
  max_ms: number;
};

const fmt = (n: number) => (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const trimSql = (s: string) => (s?.length > 240 ? s.slice(0, 240) + "…" : s ?? "");

export default function VendorDbLoad() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [growth, setGrowth] = useState(2);

  const top = useQuery({
    queryKey: ["vendor-db-load-top"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_top_db_queries", { p_limit: 25 });
      if (error) throw error;
      return (data ?? []) as TopQuery[];
    },
    refetchInterval: 60_000,
  });

  const spikes = useQuery({
    queryKey: ["vendor-db-load-spikes", growth],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_db_load_spikes", {
        p_limit: 25,
        p_min_total_ms: 1000,
        p_growth_factor: growth,
      });
      if (error) throw error;
      return (data ?? []) as Spike[];
    },
  });

  const snapshots = useQuery({
    queryKey: ["vendor-db-load-snapshots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("db_load_snapshots" as any)
        .select("id, captured_at, queryid, query_text, calls, total_ms, mean_ms, max_ms")
        .order("captured_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Snapshot[];
    },
  });

  const snap = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("capture_db_load_snapshot", { p_limit: 50 });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      toast({ title: "Snapshot captured", description: `${n} rows recorded.` });
      qc.invalidateQueries({ queryKey: ["vendor-db-load-snapshots"] });
      qc.invalidateQueries({ queryKey: ["vendor-db-load-spikes"] });
    },
    onError: (e: any) => toast({ title: "Snapshot failed", description: e.message, variant: "destructive" }),
  });

  const totalCalls = (top.data ?? []).reduce((s, r) => s + Number(r.calls || 0), 0);
  const totalMs = (top.data ?? []).reduce((s, r) => s + Number(r.total_ms || 0), 0);
  const lastSnapshot = snapshots.data?.[0]?.captured_at;
  const hotQuery = (top.data ?? [])[0];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Database className="h-6 w-6" />DB Load Monitor</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Top query drivers and spike alerts to keep Cloud usage predictable.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { top.refetch(); spikes.refetch(); snapshots.refetch(); }}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
          <Button size="sm" disabled={snap.isPending} onClick={() => snap.mutate()}>
            <Camera className="h-4 w-4 mr-2" />{snap.isPending ? "Capturing…" : "Capture snapshot"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Tracked queries</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{top.data?.length ?? 0}</div>
            <div className="text-xs text-muted-foreground">live from pg_stat_statements</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4" />Total calls (top 25)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{fmt(totalCalls)}</div>
            <div className="text-xs text-muted-foreground">since stats reset</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />Total DB time</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{fmt(totalMs / 1000)}<span className="text-base font-normal text-muted-foreground"> s</span></div>
            <div className="text-xs text-muted-foreground">aggregate of top 25</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Open spikes</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{spikes.data?.length ?? 0}</div>
            <div className="text-xs text-muted-foreground">
              {lastSnapshot ? `last snapshot ${formatDistanceToNow(new Date(lastSnapshot), { addSuffix: true })}` : "no snapshots yet"}
            </div>
          </CardContent>
        </Card>
      </div>

      {hotQuery && hotQuery.calls > 100_000 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium">High-frequency query detected</div>
              <div className="text-muted-foreground">
                {fmt(hotQuery.calls)} calls · {fmt(hotQuery.total_ms / 1000)}s total. Consider throttling the source job
                or caching the result.
              </div>
              <pre className="mt-2 text-xs bg-muted/50 p-2 rounded overflow-x-auto max-w-full whitespace-pre-wrap">{trimSql(hotQuery.query_text)}</pre>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="top">
        <TabsList>
          <TabsTrigger value="top">Top queries</TabsTrigger>
          <TabsTrigger value="spikes">Spike alerts {spikes.data?.length ? <Badge variant="destructive" className="ml-2">{spikes.data.length}</Badge> : null}</TabsTrigger>
          <TabsTrigger value="history">Snapshot history</TabsTrigger>
        </TabsList>

        <TabsContent value="top">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top queries by total DB time</CardTitle>
              <CardDescription>Ranked from pg_stat_statements (live). High call counts + low mean time usually means a tight cron loop.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Query</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Total (s)</TableHead>
                    <TableHead className="text-right">Mean (ms)</TableHead>
                    <TableHead className="text-right">Max (ms)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {top.isLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : !top.data?.length ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No data</TableCell></TableRow>
                  ) : top.data.map((r, i) => (
                    <TableRow key={`${r.queryid}-${i}`}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="max-w-xl">
                        <pre className="text-xs whitespace-pre-wrap font-mono leading-tight">{trimSql(r.query_text)}</pre>
                      </TableCell>
                      <TableCell className="text-right font-mono">{fmt(r.calls)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(r.total_ms / 1000)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(r.mean_ms)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(r.max_ms)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="spikes">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Spike alerts</span>
                <div className="flex items-center gap-2 text-xs font-normal">
                  Growth threshold:
                  {[1.5, 2, 3, 5].map((g) => (
                    <Button key={g} size="sm" variant={growth === g ? "default" : "outline"} className="h-7 px-2" onClick={() => setGrowth(g)}>
                      ×{g}
                    </Button>
                  ))}
                </div>
              </CardTitle>
              <CardDescription>Queries whose total DB time grew at least {growth}× between the two most recent snapshots.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Query</TableHead>
                    <TableHead className="text-right">Growth</TableHead>
                    <TableHead className="text-right">Prev (s)</TableHead>
                    <TableHead className="text-right">Now (s)</TableHead>
                    <TableHead className="text-right">+ Calls</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spikes.isLoading ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : !spikes.data?.length ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No spikes detected. Need at least 2 snapshots to compare.</TableCell></TableRow>
                  ) : spikes.data.map((r) => (
                    <TableRow key={r.queryid}>
                      <TableCell className="max-w-xl">
                        <pre className="text-xs whitespace-pre-wrap font-mono leading-tight">{trimSql(r.query_text)}</pre>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={r.growth_factor >= 5 ? "destructive" : "default"}>×{fmt(r.growth_factor)}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{fmt(r.prev_total_ms / 1000)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(r.curr_total_ms / 1000)}</TableCell>
                      <TableCell className="text-right font-mono">+{fmt(r.call_delta)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Snapshot history</CardTitle>
              <CardDescription>Daily snapshots run automatically at 00:05 UTC. Use Capture snapshot to take one on demand.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Captured</TableHead>
                    <TableHead>Query</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Total (s)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!snapshots.data?.length ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No snapshots yet.</TableCell></TableRow>
                  ) : snapshots.data.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs whitespace-nowrap">{formatDistanceToNow(new Date(s.captured_at), { addSuffix: true })}</TableCell>
                      <TableCell className="max-w-xl"><pre className="text-xs whitespace-pre-wrap font-mono leading-tight">{trimSql(s.query_text)}</pre></TableCell>
                      <TableCell className="text-right font-mono">{fmt(s.calls)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(s.total_ms / 1000)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
