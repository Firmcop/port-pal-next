import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@/lib/router";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpen, Download, Search } from "lucide-react";
import { format } from "date-fns";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

const SOURCE_TYPES = [
  { value: "all", label: "All sources" },
  { value: "journal", label: "Journal" },
  { value: "transfer", label: "Transfer" },
  { value: "invoice", label: "Invoice" },
  { value: "payment", label: "Payment" },
  { value: "vendor_payment", label: "Vendor Payment" },
];

function linkFor(row: any) {
  switch (row.source_type) {
    case "transfer": return "/finance/transfers";
    case "invoice": return `/billing/invoices`;
    case "payment": return `/billing/payments`;
    case "vendor_payment": return `/procurement`;
    default: return "/accounting/transactions";
  }
}

export default function FinanceLedger() {
  const [search, setSearch] = useState("");
  const [sourceType, setSourceType] = useState("all");
  const [accountId, setAccountId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cleared, setCleared] = useState("all");

  useRealtimeInvalidate([
    { table: "accounting_transactions", queryKeys: ["unified-ledger"] },
    { table: "payments", queryKeys: ["unified-ledger"] },
    { table: "vendor_payments", queryKeys: ["unified-ledger"] },
    { table: "invoices", queryKeys: ["unified-ledger"] },
    { table: "inter_account_transfers", queryKeys: ["unified-ledger"] },
  ], "ledger-rt");


  const { data: accounts } = useQuery({
    queryKey: ["financial-accounts-all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("financial_accounts").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["unified-ledger", search, sourceType, accountId, from, to, cleared],
    queryFn: async () => {
      let q = (supabase as any).from("unified_ledger_entries").select("*").order("entry_date", { ascending: false }).limit(500);
      if (sourceType !== "all") q = q.eq("source_type", sourceType);
      if (accountId !== "all") q = q.eq("financial_account_id", accountId);
      if (from) q = q.gte("entry_date", new Date(from).toISOString());
      if (to) q = q.lte("entry_date", new Date(`${to}T23:59:59`).toISOString());
      if (cleared === "cleared") q = q.not("cleared_at", "is", null);
      if (cleared === "uncleared") q = q.is("cleared_at", null);
      if (search.trim()) q = q.or(`description.ilike.%${search}%,reference_number.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const totals = useMemo(() => {
    return (rows ?? []).reduce(
      (acc: any, r: any) => ({ debit: acc.debit + Number(r.debit || 0), credit: acc.credit + Number(r.credit || 0) }),
      { debit: 0, credit: 0 }
    );
  }, [rows]);

  function exportCsv() {
    if (!rows?.length) return;
    const header = ["Date", "Source", "Reference", "Description", "Debit", "Credit", "Cleared"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        format(new Date(r.entry_date), "yyyy-MM-dd"),
        r.source_type,
        r.reference_number ?? "",
        `"${(r.description ?? "").replace(/"/g, '""')}"`,
        Number(r.debit || 0).toFixed(2),
        Number(r.credit || 0).toFixed(2),
        r.cleared_at ? "yes" : "no",
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ledger-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" />Unified Ledger</h1>
          <p className="text-muted-foreground">Search across journal entries, transfers, invoices, and payments.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!rows?.length}><Download className="mr-1 h-4 w-4" />Export CSV</Button>
      </div>

      <Card>
        <CardContent className="p-3 grid grid-cols-1 md:grid-cols-6 gap-2">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search description / reference…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={sourceType} onValueChange={setSourceType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{SOURCE_TYPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="All accounts" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts?.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select value={cleared} onValueChange={setCleared}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="cleared">Cleared</SelectItem>
              <SelectItem value="uncleared">Uncleared</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !rows?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No entries match your filters.</TableCell></TableRow>
              ) : rows.map((r: any) => (
                <TableRow key={r.entry_id}>
                  <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.entry_date), "yyyy-MM-dd")}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{r.source_type.replace("_"," ")}</Badge></TableCell>
                  <TableCell className="font-mono text-xs"><Link to={linkFor(r)} className="hover:underline">{r.reference_number}</Link></TableCell>
                  <TableCell className="max-w-md truncate">{r.description}</TableCell>
                  <TableCell className="text-right font-mono">{Number(r.debit) > 0 ? Number(r.debit).toFixed(2) : ""}</TableCell>
                  <TableCell className="text-right font-mono">{Number(r.credit) > 0 ? Number(r.credit).toFixed(2) : ""}</TableCell>
                  <TableCell>{r.cleared_at ? <Badge variant="secondary" className="bg-success/15 text-success">cleared</Badge> : <Badge variant="outline">open</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground flex justify-between">
        <span>{rows?.length ?? 0} entries (max 500)</span>
        <span className="font-mono">Σ Debit {totals.debit.toFixed(2)} · Σ Credit {totals.credit.toFixed(2)}</span>
      </div>
    </div>
  );
}
