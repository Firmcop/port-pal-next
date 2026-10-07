import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download } from "lucide-react";
import { format, subDays } from "date-fns";

type Row = {
  movement_id: string | null;
  container_id: string | null;
  container_number: string | null;
  owner: string | null;
  shipping_line: string | null;
  gate_in_at: string | null;
  expected_amount: number | null;
  expected_currency: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  billed_amount: number | null;
  paid_amount: number | null;
  variance: number | null;
  reconciliation_state: string;
};

const stateColors: Record<string, string> = {
  matched: "bg-success/15 text-success border-success/30",
  unbilled: "bg-warning/15 text-warning border-warning/30",
  amount_mismatch: "bg-destructive/15 text-destructive border-destructive/30",
  voided: "bg-muted text-muted-foreground border-border",
  orphan_invoice: "bg-purple-500/15 text-purple-700 border-purple-300",
};

export default function GateFeeReconciliation() {
  const [depotId, setDepotId] = useState<string>("all");
  const [from, setFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [owner, setOwner] = useState("");
  const [stateFilter, setStateFilter] = useState("all");

  const { data: depots } = useQuery({
    queryKey: ["depots-reconciliation"],
    queryFn: async () => {
      const { data, error } = await supabase.from("depots").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: ownerOptions } = useQuery({
    queryKey: ["distinct-owners"],
    queryFn: async () => {
      const { data, error } = await supabase.from("containers").select("owner, shipping_line").limit(2000);
      if (error) throw error;
      const set = new Set<string>();
      (data ?? []).forEach((r: any) => { if (r.owner) set.add(r.owner); if (r.shipping_line) set.add(r.shipping_line); });
      return Array.from(set).sort();
    },
  });

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["gate-fee-reconciliation", depotId, from, to, owner],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gate_in_reconciliation" as any, {
        _depot_id: depotId === "all" ? null : depotId,
        _from: from || null,
        _to: to || null,
        _owner: owner ? owner : null,
      });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = useMemo(
    () => (data ?? []).filter((r) => stateFilter === "all" || r.reconciliation_state === stateFilter),
    [data, stateFilter],
  );

  const kpis = useMemo(() => {
    const all = data ?? [];
    const events = all.filter((r) => r.movement_id);
    const billed = events.filter((r) => r.invoice_id && !["voided"].includes(r.reconciliation_state));
    const expected = events.reduce((s, r) => s + (Number(r.expected_amount) || 0), 0);
    const billedTotal = billed.reduce((s, r) => s + (Number(r.billed_amount) || 0), 0);
    const paid = all.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);
    return {
      events: events.length,
      billed: billed.length,
      unbilled: events.filter((r) => r.reconciliation_state === "unbilled").length,
      mismatched: events.filter((r) => r.reconciliation_state === "amount_mismatch").length,
      orphans: all.filter((r) => r.reconciliation_state === "orphan_invoice").length,
      expected,
      billedTotal,
      paid,
      variance: billedTotal - expected,
    };
  }, [data]);

  const exportCsv = () => {
    const header = ["Container","Owner","Shipping line","Gate-in","Expected","Currency","Invoice #","Status","Billed","Paid","Variance","State"];
    const lines = [header.join(",")].concat(
      rows.map((r) => [
        r.container_number ?? "",
        r.owner ?? "",
        r.shipping_line ?? "",
        r.gate_in_at ? format(new Date(r.gate_in_at), "yyyy-MM-dd HH:mm") : "",
        r.expected_amount ?? "",
        r.expected_currency ?? "",
        r.invoice_number ?? "",
        r.invoice_status ?? "",
        r.billed_amount ?? "",
        r.paid_amount ?? "",
        r.variance ?? "",
        r.reconciliation_state,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `gate-fee-reconciliation-${from}-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gate-Fee Reconciliation</h1>
          <p className="text-muted-foreground">Compare billed gate-in fees with actual gate-in events.</p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
          <Download className="mr-1 h-4 w-4" />Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 grid gap-3 md:grid-cols-5">
          <div className="space-y-2">
            <Label>Depot</Label>
            <Select value={depotId} onValueChange={setDepotId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All depots</SelectItem>
                {depots?.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Owner / Shipping line</Label>
            <Select value={owner || "__all"} onValueChange={(v) => setOwner(v === "__all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Any</SelectItem>
                {ownerOptions?.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>State</Label>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="matched">Matched</SelectItem>
                <SelectItem value="unbilled">Unbilled</SelectItem>
                <SelectItem value="amount_mismatch">Amount mismatch</SelectItem>
                <SelectItem value="voided">Voided</SelectItem>
                <SelectItem value="orphan_invoice">Orphan invoice</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-5 flex justify-end">
            <Button size="sm" onClick={() => refetch()} disabled={isFetching}>Apply</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Gate-ins", value: kpis.events },
          { label: "Billed", value: kpis.billed },
          { label: "Unbilled", value: kpis.unbilled },
          { label: "Mismatched", value: kpis.mismatched },
          { label: "Orphan invoices", value: kpis.orphans },
        ].map((k) => (
          <Card key={k.label}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{k.label}</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{k.value}</div></CardContent></Card>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Expected</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-mono">{kpis.expected.toFixed(2)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Billed</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-mono">{kpis.billedTotal.toFixed(2)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Paid</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-mono">{kpis.paid.toFixed(2)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Variance (billed - expected)</CardTitle></CardHeader>
          <CardContent><div className={`text-xl font-mono ${kpis.variance < 0 ? "text-destructive" : kpis.variance > 0 ? "text-warning" : ""}`}>{kpis.variance.toFixed(2)}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Container</TableHead>
                <TableHead>Owner / Line</TableHead>
                <TableHead>Gate-in</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={9} />
              ) : !rows.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No records</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={`${r.movement_id ?? r.invoice_id ?? i}`}>
                  <TableCell className="font-mono text-sm">{r.container_number ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.owner ?? r.shipping_line ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.gate_in_at ? format(new Date(r.gate_in_at), "PPp") : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{r.expected_amount != null ? `${Number(r.expected_amount).toFixed(2)} ${r.expected_currency ?? ""}` : "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{r.invoice_number ?? "—"}</TableCell>
                  <TableCell className="text-sm capitalize">{r.invoice_status ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{r.billed_amount != null ? Number(r.billed_amount).toFixed(2) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{r.paid_amount != null ? Number(r.paid_amount).toFixed(2) : "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={stateColors[r.reconciliation_state] ?? ""}>{r.reconciliation_state.replace("_"," ")}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
