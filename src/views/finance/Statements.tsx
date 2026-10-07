import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileSpreadsheet, FileDown, FileText } from "lucide-react";
import { exportCSV, exportPDF } from "@/lib/export-utils";
import { fmtMoney } from "@/lib/finance-format";

export default function Statements() {
  const [mode, setMode] = useState<"customer" | "supplier">("customer");
  const [customer, setCustomer] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [from, setFrom] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  // Netting policy drives whether we present a combined AP/AR position (IAS 32 set-off).
  const { data: policy } = useQuery({
    queryKey: ["accounting-policy"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_accounting_policy");
      if (error) throw error;
      return data as any;
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["distinct-invoice-customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("customer_name").limit(1000);
      if (error) throw error;
      return Array.from(new Set((data ?? []).map((d: any) => d.customer_name).filter(Boolean))).sort();
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: lines } = useQuery({
    queryKey: ["statement", mode, customer, supplierId, from, to],
    enabled: mode === "customer" ? !!customer : !!supplierId,
    queryFn: async () => {
      if (mode === "customer") {
        const { data, error } = await supabase.rpc("customer_statement" as any, { _customer: customer, _from: from, _to: to });
        if (error) throw error;
        return data as any[];
      }
      const { data, error } = await supabase.rpc("supplier_statement" as any, { _supplier: supplierId, _from: from, _to: to });
      if (error) throw error;
      return data as any[];
    },
  });

  const totals = useMemo(() => {
    let debit = 0, credit = 0;
    (lines ?? []).forEach((l: any) => { debit += Number(l.debit || 0); credit += Number(l.credit || 0); });
    return { debit, credit, balance: debit - credit };
  }, [lines]);

  const headers = ["Date", "Type", "Doc #", "Description", "Debit", "Credit"];
  const rows = () => (lines ?? []).map((l: any) => [l.doc_date, l.doc_type, l.doc_number, l.description, String(l.debit ?? ""), String(l.credit ?? "")]);
  const { data: position } = useQuery({
    queryKey: ["counterparty-position", mode, customer, supplierId],
    enabled: mode === "customer" ? !!customer : !!supplierId,
    queryFn: async () => {
      let customerId: string | null = null;
      if (mode === "customer") {
        const { data: c } = await supabase.from("customers").select("id").eq("company_name", customer).maybeSingle();
        customerId = c?.id ?? null;
        if (!customerId) return null;
      }
      const { data, error } = await (supabase as any).rpc("counterparty_position", {
        _customer_id: customerId,
        _supplier_id: mode === "supplier" ? supplierId : null,
      });
      if (error) throw error;
      return data as any;
    },
  });

  const netRows: any[] = Array.isArray(position?.positions) ? position.positions : [];
  const showNet = !!policy?.netting_enabled && netRows.length > 0;

  const title = mode === "customer" ? `Customer Statement — ${customer || "—"}` : `Supplier Statement — ${suppliers?.find((s) => s.id === supplierId)?.name || "—"}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileSpreadsheet className="h-6 w-6" />Statements</h1>
        <p className="text-muted-foreground">Customer and supplier ledger statements over a date range.</p>
      </div>

      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(v: any) => setMode(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="supplier">Supplier</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "customer" ? (
            <div className="md:col-span-2">
              <Label>Customer</Label>
              <Select value={customer} onValueChange={setCustomer}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>{(customers ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : (
            <div className="md:col-span-2">
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>{(suppliers ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between p-3">
            <div className="text-sm text-muted-foreground">{lines?.length ?? 0} entries</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!lines?.length} onClick={() => exportCSV("statement.csv", headers, rows())}><FileDown className="h-4 w-4 mr-1" />CSV</Button>
              <Button size="sm" variant="outline" disabled={!lines?.length} onClick={() => exportPDF(title, "statement.pdf", headers, rows())}><FileText className="h-4 w-4 mr-1" />PDF</Button>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Doc #</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!lines?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Select a party to view statement.</TableCell></TableRow>
              ) : (
                <>
                  {lines.map((l: any, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{l.doc_date}</TableCell>
                      <TableCell><span className="capitalize text-xs">{l.doc_type}</span></TableCell>
                      <TableCell className="font-mono text-xs">{l.doc_number}</TableCell>
                      <TableCell className="max-w-[300px] truncate">{l.description}</TableCell>
                      <TableCell className="text-right font-mono">{Number(l.debit) > 0 ? Number(l.debit).toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{Number(l.credit) > 0 ? Number(l.credit).toLocaleString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold bg-muted/40">
                    <TableCell colSpan={4} className="text-right">Totals</TableCell>
                    <TableCell className="text-right font-mono">{totals.debit.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{totals.credit.toLocaleString()}</TableCell>
                  </TableRow>
                  <TableRow className="font-bold">
                    <TableCell colSpan={5} className="text-right">Outstanding balance</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(totals.balance)}</TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {showNet && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="text-sm font-semibold">Counterparty net position (IAS 32 set-off)</div>
            <p className="text-xs text-muted-foreground">
              Presentation basis: {policy?.presentation_basis === "net" ? "Net" : "Gross"}. Amounts below combine receivables and payables for the same legal counterparty.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">Receivable (AR)</TableHead>
                  <TableHead className="text-right">Payable (AP)</TableHead>
                  <TableHead className="text-right">Offsettable</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {netRows.map((r: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.currency}</TableCell>
                    <TableCell className="text-right font-mono">{Number(r.ar_open ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{Number(r.ap_open ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{Number(r.offsettable ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{Number(r.net ?? 0).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
