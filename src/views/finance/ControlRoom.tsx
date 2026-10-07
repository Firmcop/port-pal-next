import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, CheckCircle2, Gauge, RefreshCw, Scale, Wand2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatMoneyCode } from "@/lib/money";
import { format } from "date-fns";

type TrialRow = {
  currency: string;
  account_type: string;
  gl_code: string | null;
  gl_name: string | null;
  debit: number;
  credit: number;
  balance: number;
  entries: number;
};

type FeedRow = {
  module: string;
  documents: number;
  posted: number;
  unposted: number;
  last_posted: string | null;
};

type UnbalancedRow = {
  reference_type: string | null;
  reference_id: string | null;
  currency: string | null;
  debit: number;
  credit: number;
  difference: number;
  entries: number;
  last_posted: string | null;
};

const REF_LABEL: Record<string, string> = {
  supplier_invoices: "Purchase invoice",
  container_sales: "Container sale",
  container_conversions: "Conversion job",
  invoice: "Customer invoice",
  payment: "Customer payment",
  goods_receipt: "Goods receipt",
  operating_expense: "Operating expense",
  trip_cost: "Trip cost",
  trip_revenue: "Trip income",
  repatriation: "Repatriation",
  depreciation_run: "Depreciation run",
  loan_opening: "Loan opening balance",
};

const num = (v: unknown) => Number(v ?? 0);

export default function ControlRoom() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const trial = useQuery({
    queryKey: ["finance-control-trial-balance"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("finance_trial_balance", { _currency: null });
      if (error) throw error;
      return (data ?? []) as TrialRow[];
    },
  });

  const feeds = useQuery({
    queryKey: ["finance-control-feeds"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("finance_module_feed_status");
      if (error) throw error;
      return (data ?? []) as FeedRow[];
    },
  });

  const unbalanced = useQuery({
    queryKey: ["finance-control-unbalanced"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("finance_unbalanced_documents");
      if (error) throw error;
      return (data ?? []) as UnbalancedRow[];
    },
  });

  const missingFx = useQuery({
    queryKey: ["finance-control-missing-fx"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("accounting_transactions")
        .select("id, transaction_number, transaction_date, description, currency, debit_amount, credit_amount")
        .is("fx_rate", null)
        .order("transaction_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const byCurrency = useMemo(() => {
    const map = new Map<string, { debit: number; credit: number }>();
    (trial.data ?? []).forEach((r) => {
      const key = r.currency ?? "—";
      const cur = map.get(key) ?? { debit: 0, credit: 0 };
      cur.debit += num(r.debit);
      cur.credit += num(r.credit);
      map.set(key, cur);
    });
    return [...map.entries()].map(([currency, v]) => ({
      currency,
      debit: v.debit,
      credit: v.credit,
      difference: Math.round((v.debit - v.credit) * 100) / 100,
    }));
  }, [trial.data]);

  const refreshAll = () =>
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("finance-") });

  async function run(name: string, rpc: string) {
    setBusy(name);
    try {
      const { error } = await (supabase as any).rpc(rpc);
      if (error) throw error;
      toast({ title: "Done", description: "Entries brought up to date." });
      refreshAll();
    } catch (e: any) {
      toast({ title: "Could not run", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const currencies = useMemo(
    () => [...new Set((trial.data ?? []).map((r) => r.currency).filter(Boolean))] as string[],
    [trial.data]
  );

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            Finance Control Room
          </h1>
          <p className="text-sm text-muted-foreground">
            One place to see whether every module is feeding finance and whether the books balance.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {byCurrency.map((c) => {
          const ok = Math.abs(c.difference) <= 0.01;
          return (
            <Card key={c.currency} className={ok ? "border-success/40" : "border-destructive/60"}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {ok ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  )}
                  {c.currency} ledger
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Debits</span>
                  <span className="font-mono tabular-nums">{formatMoneyCode(c.debit, c.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Credits</span>
                  <span className="font-mono tabular-nums">{formatMoneyCode(c.credit, c.currency)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Difference</span>
                  <span className="font-mono tabular-nums">{formatMoneyCode(c.difference, c.currency)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {trial.isLoading && <Skeleton className="h-28" />}
      </div>

      <Tabs defaultValue="feeds">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="feeds">Module feeds</TabsTrigger>
          <TabsTrigger value="trial">Trial balance</TabsTrigger>
          <TabsTrigger value="unbalanced">
            One-sided documents
            {(unbalanced.data?.length ?? 0) > 0 && (
              <Badge variant="secondary" className="ml-2">{unbalanced.data?.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="fx">
            Missing exchange rate
            {(missingFx.data?.length ?? 0) > 0 && (
              <Badge variant="secondary" className="ml-2">{missingFx.data?.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="feeds" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Is every module feeding finance?</CardTitle>
              <CardDescription>
                Documents raised in each module against those that reached the ledger.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === "gr"}
                  onClick={() => run("gr", "backfill_goods_receipt_postings")}
                >
                  <Wand2 className="h-3 w-3 mr-1" />
                  {busy === "gr" ? "Posting…" : "Post missing goods receipts"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === "trip"}
                  onClick={() => run("trip", "backfill_trip_revenue_postings")}
                >
                  <Wand2 className="h-3 w-3 mr-1" />
                  {busy === "trip" ? "Posting…" : "Post missing trip income"}
                </Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Module</TableHead>
                      <TableHead className="text-right">Documents</TableHead>
                      <TableHead className="text-right">In the ledger</TableHead>
                      <TableHead className="text-right">Not posted</TableHead>
                      <TableHead>Last posted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(feeds.data ?? []).map((f) => (
                      <TableRow key={f.module}>
                        <TableCell className="font-medium">{f.module}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{num(f.documents)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{num(f.posted)}</TableCell>
                        <TableCell className="text-right">
                          {num(f.unposted) > 0 ? (
                            <Badge variant="secondary" className="bg-warning/15 text-warning">
                              {num(f.unposted)}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {f.last_posted ? format(new Date(f.last_posted), "dd MMM yyyy") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {feeds.isLoading && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Skeleton className="h-6" />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trial" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Scale className="h-4 w-4" /> Trial balance by currency
              </CardTitle>
              <CardDescription>Every account, in the currency it was recorded in.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {currencies.map((cur) => (
                <div key={cur} className="space-y-2">
                  <p className="text-sm font-medium">{cur}</p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Debit</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(trial.data ?? [])
                          .filter((r) => r.currency === cur)
                          .map((r, i) => (
                            <TableRow key={`${cur}-${r.gl_code ?? "none"}-${r.account_type}-${i}`}>
                              <TableCell className="font-medium">
                                {r.gl_code ? `${r.gl_code} — ${r.gl_name}` : "Not mapped to an account"}
                              </TableCell>
                              <TableCell className="capitalize text-muted-foreground">
                                {r.account_type?.replace(/_/g, " ")}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {formatMoneyCode(num(r.debit), cur)}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {formatMoneyCode(num(r.credit), cur)}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {formatMoneyCode(num(r.balance), cur)}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="unbalanced" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Documents recorded on one side only</CardTitle>
              <CardDescription>
                Each of these has a value recorded without its matching entry. Empty is good.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(unbalanced.data ?? []).length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" /> Every document is recorded on both sides.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Document type</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead className="text-right">Debits</TableHead>
                        <TableHead className="text-right">Credits</TableHead>
                        <TableHead className="text-right">Difference</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(unbalanced.data ?? []).map((r, i) => (
                        <TableRow key={`${r.reference_id}-${r.currency}-${i}`}>
                          <TableCell className="font-medium">
                            {REF_LABEL[r.reference_type ?? ""] ?? r.reference_type ?? "Unlinked entry"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {r.reference_id ? r.reference_id.slice(0, 8) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatMoneyCode(num(r.debit), r.currency ?? "")}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatMoneyCode(num(r.credit), r.currency ?? "")}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-destructive">
                            {formatMoneyCode(num(r.difference), r.currency ?? "")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fx" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Entries without an exchange rate</CardTitle>
              <CardDescription>
                No rate existed for these dates, so no rate was guessed. Add the rate under Finance → FX Rates.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(missingFx.data ?? []).length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" /> Every entry carries a rate.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Entry</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(missingFx.data ?? []).map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-sm">
                            {format(new Date(r.transaction_date), "dd MMM yyyy")}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.transaction_number}</TableCell>
                          <TableCell className="max-w-[380px] truncate">{r.description}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatMoneyCode(num(r.debit_amount) || num(r.credit_amount), r.currency ?? "")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
