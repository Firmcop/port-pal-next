import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";
import { Inbox, Search } from "lucide-react";

const sb = supabase as any;

/** What a receipt can be when it is not a customer paying an invoice. */
const RECEIPT_TARGETS = [
  { code: "1090", label: "Own transfer from another of our accounts" },
  { code: "3300", label: "Director's money (director's current account)" },
  { code: "2500", label: "Loan received" },
  { code: "2400", label: "Customer deposit (no invoice yet)" },
  { code: "4900", label: "Other income" },
  { code: "6900", label: "Refund of an expense" },
];

interface Line {
  ledger_line_id: string;
  kind: "receipt" | "missing_account" | "material_job";
  on_date: string;
  amount: number;
  remaining: number;
  description: string;
  currency: string;
  mpesa_code: string | null;
}

export default function CashToSort() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Line | null>(null);

  const { data: lines, isLoading } = useQuery({
    queryKey: ["cash-to-sort"],
    queryFn: async () => {
      const { data, error } = await sb.from("v_cash_to_sort").select("*").gt("remaining", 0.004).order("on_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Line[];
    },
  });

  const by = (k: Line["kind"]) => {
    const list = (lines ?? []).filter((l) => l.kind === k);
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((l) => `${l.description} ${l.mpesa_code ?? ""} ${l.amount}`.toLowerCase().includes(needle)) : list;
  };
  const total = (k: Line["kind"]) => (lines ?? []).filter((l) => l.kind === k).reduce((s, l) => s + Number(l.remaining), 0);
  const count = (k: Line["kind"]) => (lines ?? []).filter((l) => l.kind === k).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Inbox className="h-6 w-6" />Cash to sort</h1>
        <p className="text-muted-foreground">
          Money that came in or went out without the books knowing what it was for. Each item you sort is posted in the month the money moved.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search name, M-Pesa code, amount" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Tabs defaultValue="receipt">
        <TabsList>
          <TabsTrigger value="receipt">Receipts to apply ({count("receipt")} · {fmtMoney(total("receipt"))})</TabsTrigger>
          <TabsTrigger value="material_job">Materials without a job ({count("material_job")} · {fmtMoney(total("material_job"))})</TabsTrigger>
          <TabsTrigger value="missing_account">Payments with no account ({count("missing_account")} · {fmtMoney(total("missing_account"))})</TabsTrigger>
        </TabsList>
        {(["receipt", "material_job", "missing_account"] as const).map((k) => (
          <TabsContent key={k} value={k}>
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead><TableHead>Details</TableHead>
                      <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Left to sort</TableHead><TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                    ) : !by(k).length ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nothing to sort here.</TableCell></TableRow>
                    ) : by(k).map((l) => (
                      <TableRow key={l.ledger_line_id}>
                        <TableCell className="text-xs whitespace-nowrap">{l.on_date}</TableCell>
                        <TableCell className="text-sm">
                          {l.description}
                          {l.mpesa_code && <Badge variant="outline" className="ml-2 font-mono text-[10px]">{l.mpesa_code}</Badge>}
                        </TableCell>
                        <TableCell className="text-right font-mono">{fmtMoney(l.amount)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtMoney(l.remaining)}</TableCell>
                        <TableCell><Button size="sm" variant="outline" onClick={() => setActive(l)}>Sort</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {active?.kind === "receipt" && <ReceiptDialog line={active} onClose={() => setActive(null)} />}
      {active?.kind === "missing_account" && <AccountDialog line={active} onClose={() => setActive(null)} />}
      {active?.kind === "material_job" && <JobDialog line={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function useDone(onClose: () => void, title: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return () => {
    ["cash-to-sort", "invoices", "payments"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    toast({ title });
    onClose();
  };
}

function ReceiptDialog({ line, onClose }: { line: Line; onClose: () => void }) {
  const [mode, setMode] = useState<"invoice" | "other">("invoice");
  const [invoiceId, setInvoiceId] = useState("");
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState(String(line.remaining));
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const done = useDone(onClose, "Receipt sorted");

  const { data: suggestions } = useQuery({
    queryKey: ["cash-sort-suggest", line.ledger_line_id],
    queryFn: async () => (await sb.rpc("cash_to_sort_suggestions", { _ledger_line_id: line.ledger_line_id })).data ?? [],
  });
  const { data: openInvoices } = useQuery({
    queryKey: ["open-invoices-pick", search],
    queryFn: async () => {
      let qy = sb.from("invoices").select("id, invoice_number, customer_name, total_amount, currency, status")
        .in("status", ["sent", "overdue"]).order("issued_at", { ascending: false }).limit(30);
      if (search.trim()) qy = qy.or(`invoice_number.ilike.%${search.trim()}%,customer_name.ilike.%${search.trim()}%`);
      return (await qy).data ?? [];
    },
  });
  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; label: string }[] = [];
    for (const s of suggestions ?? []) {
      if (seen.has(s.invoice_id)) continue; seen.add(s.invoice_id);
      out.push({ id: s.invoice_id, label: `★ ${s.invoice_number} · ${s.customer_name} · owes ${fmtMoney(s.balance)}` });
    }
    for (const i of openInvoices ?? []) {
      if (seen.has(i.id)) continue; seen.add(i.id);
      out.push({ id: i.id, label: `${i.invoice_number} · ${i.customer_name} · ${fmtMoney(i.total_amount)} ${i.currency ?? ""}` });
    }
    return out;
  }, [suggestions, openInvoices]);

  const save = useMutation({
    mutationFn: async () => {
      setErr(null);
      const amt = Number(amount);
      if (!(amt > 0)) throw new Error("Enter the amount");
      if (mode === "invoice") {
        if (!invoiceId) throw new Error("Pick the invoice");
        const { error } = await sb.rpc("cash_sort_apply_to_invoice", { _ledger_line_id: line.ledger_line_id, _invoice_id: invoiceId, _amount: amt });
        if (error) throw error;
      } else {
        if (!target) throw new Error("Say what the money was");
        const label = RECEIPT_TARGETS.find((t) => t.code === target)?.label ?? "";
        const { error } = await sb.rpc("cash_sort_reclass", {
          _ledger_line_id: line.ledger_line_id, _amount: amt, _target_gl_code: target, _financial_account_id: null,
          _note: note.trim() || label,
        });
        if (error) throw error;
      }
    },
    onSuccess: done,
    onError: (e: any) => setErr(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sort a receipt of {fmtMoney(line.remaining)}</DialogTitle>
          <DialogDescription>{line.on_date} · {line.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={mode} onValueChange={(v) => setMode(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="invoice">A customer paying an invoice</SelectItem>
              <SelectItem value="other">Something else (transfer, director, loan…)</SelectItem>
            </SelectContent>
          </Select>
          {mode === "invoice" ? (
            <>
              <div className="space-y-1">
                <Label>Find invoice</Label>
                <Input placeholder="Invoice number or customer" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={invoiceId || undefined} onValueChange={setInvoiceId}>
                <SelectTrigger><SelectValue placeholder={options.length ? "Pick the invoice (★ = name matches)" : "No open invoices found"} /></SelectTrigger>
                <SelectContent>{options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </>
          ) : (
            <>
              <Select value={target || undefined} onValueChange={setTarget}>
                <SelectTrigger><SelectValue placeholder="What was it?" /></SelectTrigger>
                <SelectContent>{RECEIPT_TARGETS.map((t) => <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            </>
          )}
          <div className="space-y-1">
            <Label>Amount</Label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="text-xs text-muted-foreground">Part of a receipt can go to one invoice and the rest elsewhere.</p>
          </div>
        </div>
        {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountDialog({ line, onClose }: { line: Line; onClose: () => void }) {
  const [accountId, setAccountId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const done = useDone(onClose, "Account set");
  const { data: accounts } = useQuery({
    queryKey: ["financial-accounts-pick"],
    queryFn: async () => (await sb.from("financial_accounts").select("id, name").eq("is_active", true).order("name")).data ?? [],
  });
  const save = useMutation({
    mutationFn: async () => {
      setErr(null);
      const name = (accounts ?? []).find((a: any) => a.id === accountId)?.name ?? "account";
      const { error } = await sb.rpc("cash_sort_reclass", {
        _ledger_line_id: line.ledger_line_id, _amount: Number(line.remaining), _target_gl_code: null,
        _financial_account_id: accountId, _note: `Paid from ${name}`,
      });
      if (error) throw error;
    },
    onSuccess: done,
    onError: (e: any) => setErr(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Which account paid {fmtMoney(line.remaining)}?</DialogTitle>
          <DialogDescription>{line.on_date} · {line.description}</DialogDescription>
        </DialogHeader>
        <Select value={accountId || undefined} onValueChange={setAccountId}>
          <SelectTrigger><SelectValue placeholder="Pick the account" /></SelectTrigger>
          <SelectContent>{(accounts ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
        </Select>
        {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!accountId || save.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobDialog({ line, onClose }: { line: Line; onClose: () => void }) {
  const [jobId, setJobId] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const done = useDone(onClose, "Purchase sorted");
  const { data: jobs } = useQuery({
    queryKey: ["jobs-running-on", line.on_date],
    queryFn: async () => (await sb.rpc("jobs_running_on", { _on: line.on_date })).data ?? [],
  });
  const save = useMutation({
    mutationFn: async () => {
      setErr(null);
      const { error } = await sb.rpc("cash_sort_tag_job", {
        _ledger_line_id: line.ledger_line_id, _conversion_id: jobId === "__overhead__" ? null : jobId, _note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: done,
    onError: (e: any) => setErr(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Which job were these materials for?</DialogTitle>
          <DialogDescription>{line.on_date} · {fmtMoney(line.amount)} · {line.description}</DialogDescription>
        </DialogHeader>
        <Select value={jobId || undefined} onValueChange={setJobId}>
          <SelectTrigger><SelectValue placeholder="Jobs running around that date" /></SelectTrigger>
          <SelectContent>
            {(jobs ?? []).map((j: any) => <SelectItem key={j.conversion_id} value={j.conversion_id}>{j.label}</SelectItem>)}
            <SelectItem value="__overhead__">No single job — workshop overhead</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!jobId || save.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
