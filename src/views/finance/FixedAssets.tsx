import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Boxes, PlayCircle, BookCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";

export default function FixedAssets() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [periodId, setPeriodId] = useState("");
  const blank = () => ({ code: "", name: "", category: "", cost: 0, salvage_value: 0, useful_life_months: 60, method: "straight_line",
                         acquisition_date: new Date().toISOString().slice(0, 10) });
  const [form, setForm] = useState(blank);
  const [posting, setPosting] = useState<any | null>(null);

  const { data: assets } = useQuery({
    queryKey: ["fixed-assets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fixed_assets" as any).select("*").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: periods } = useQuery({
    queryKey: ["periods-for-depr"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_periods" as any).select("id,year,month").order("year", { ascending: false }).order("month");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: runs } = useQuery({
    queryKey: ["depr-runs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fixed_asset_depreciation_runs" as any).select("*, fiscal_periods(year,month)").order("run_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fixed_assets" as any).insert({ ...form, organization_id: org.organizationId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fixed-assets"] }); setOpen(false); setForm(blank());
      toast({ title: "Asset added", description: Number(form.cost) >= CAPITALISE_FROM ? "Use “Post to books” to put its cost on the balance sheet." : undefined });  },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runDepr = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("run_depreciation" as any, { _period_id: periodId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["depr-runs"] }); qc.invalidateQueries({ queryKey: ["fixed-assets"] }); toast({ title: "Depreciation run completed" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="h-6 w-6" />Fixed Assets</h1>
          <p className="text-muted-foreground">
            Register and depreciate long-lived assets. Items costing KES {CAPITALISE_FROM.toLocaleString()} or more go on the balance sheet
            and are depreciated each month; cheaper items stay in the register but are expensed.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add asset</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New fixed asset</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
              </div>
              <div><Label>Bought on</Label><Input type="date" value={form.acquisition_date} onChange={(e) => setForm({ ...form, acquisition_date: e.target.value })} /></div>
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Cost</Label><Input type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} /></div>
                <div><Label>Salvage</Label><Input type="number" step="0.01" value={form.salvage_value} onChange={(e) => setForm({ ...form, salvage_value: Number(e.target.value) })} /></div>
                <div><Label>Life (mo)</Label><Input type="number" value={form.useful_life_months} onChange={(e) => setForm({ ...form, useful_life_months: Number(e.target.value) })} /></div>
              </div>
              <div>
                <Label>Method</Label>
                <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="straight_line">Straight Line</SelectItem>
                    <SelectItem value="declining">Declining Balance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!form.code || !form.name || create.isPending}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead>
                <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Accum. Depr.</TableHead>
                <TableHead className="text-right">NBV</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead>Books</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!assets?.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No assets yet.</TableCell></TableRow>
              ) : assets.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.code}</TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell className="text-xs">{a.category || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(a.cost)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(a.accumulated_depreciation)}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{fmtMoney(Number(a.cost) - Number(a.accumulated_depreciation))}</TableCell>
                  <TableCell className="text-xs">{a.method}</TableCell>
                  <TableCell><Badge variant="secondary">{a.status}</Badge></TableCell>
                  <TableCell>
                    {a.capitalised_at ? <Badge variant="outline">On the books</Badge>
                      : Number(a.cost) > 0 && Number(a.cost) < CAPITALISE_FROM ? <span className="text-xs text-muted-foreground">Expensed (under {CAPITALISE_FROM.toLocaleString()})</span>
                      : <Button size="sm" variant="outline" onClick={() => setPosting(a)}><BookCheck className="h-3 w-3 mr-1" />Post to books</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {posting && <PostToBooksDialog asset={posting} onClose={() => setPosting(null)}
        onDone={() => { qc.invalidateQueries({ queryKey: ["fixed-assets"] }); setPosting(null); }} />}

      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-semibold">Depreciation Runs</h2>
          <p className="text-xs text-muted-foreground">Runs automatically on the 2nd of each month for the month before.</p>
          <div className="flex items-end gap-3">
            <div className="min-w-[200px]">
              <Label>Period</Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger><SelectValue placeholder="Select period…" /></SelectTrigger>
                <SelectContent>
                  {(periods ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.year}-{String(p.month).padStart(2, "0")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => runDepr.mutate()} disabled={!periodId || runDepr.isPending}><PlayCircle className="h-4 w-4 mr-1" />Run</Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Period</TableHead><TableHead>Assets</TableHead><TableHead className="text-right">Total Depreciation</TableHead><TableHead>Notes</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {!runs?.length ? (
                <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No runs.</TableCell></TableRow>
              ) : runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.fiscal_periods?.year}-{String(r.fiscal_periods?.month).padStart(2, "0")}</TableCell>
                  <TableCell>{r.asset_count}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.total_depreciation)}</TableCell>
                  <TableCell className="text-xs">{r.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

const CAPITALISE_FROM = 20000;

/** Put an asset's cost on Fixed Assets (1500), against how it was paid for. */
function PostToBooksDialog({ asset, onClose, onDone }: { asset: any; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [cost, setCost] = useState<string>(String(Number(asset.cost) || ""));
  const [date, setDate] = useState<string>(asset.acquisition_date ?? new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState<"expense" | "account" | "payable" | "opening">("account");
  const [ledgerId, setLedgerId] = useState("");
  const [accountId, setAccountId] = useState("");

  const { data: accounts } = useQuery({
    queryKey: ["financial-accounts-pick"],
    queryFn: async () => (await (supabase as any).from("financial_accounts").select("id, name").order("name")).data ?? [],
  });
  // expense lines of about the same amount within 60 days of purchase
  const { data: expenses } = useQuery({
    queryKey: ["asset-expense-candidates", cost, date],
    enabled: source === "expense" && Number(cost) > 0,
    queryFn: async () => {
      const d = new Date(date);
      const from = new Date(d.getTime() - 60 * 864e5).toISOString().slice(0, 10);
      const to = new Date(d.getTime() + 60 * 864e5).toISOString().slice(0, 10);
      const { data } = await (supabase as any).from("accounting_transactions")
        .select("id, transaction_date, debit_amount, description, transaction_number")
        .in("account_type", ["expense", "cost_of_goods"]).gt("debit_amount", 0)
        .gte("debit_amount", Number(cost) * 0.98).lte("debit_amount", Number(cost) * 1.02)
        .gte("transaction_date", from).lte("transaction_date", to).order("transaction_date").limit(25);
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!(Number(cost) > 0)) throw new Error("Enter the cost");
      const { error: uErr } = await (supabase as any).from("fixed_assets").update({ cost: Number(cost), acquisition_date: date }).eq("id", asset.id);
      if (uErr) throw uErr;
      const { error } = await supabase.rpc("capitalise_fixed_asset" as any, {
        _asset_id: asset.id, _source: source,
        _source_ledger_id: source === "expense" ? ledgerId || null : null,
        _financial_account_id: source === "account" ? accountId || null : null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: `${asset.name} is on the books`, description: "Depreciation starts from the month it was bought." }); onDone(); },
    onError: (e: any) => toast({ title: "Could not post", description: e.message, variant: "destructive" }),
  });

  const below = Number(cost) > 0 && Number(cost) < CAPITALISE_FROM;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Post {asset.name} to the books</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Cost</Label><Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
            <div><Label>Bought on</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          {below && <p className="text-xs text-warning">Under KES {CAPITALISE_FROM.toLocaleString()}: normally expensed rather than put on the books.</p>}
          <div>
            <Label>How was it paid for?</Label>
            <Select value={source} onValueChange={(v) => setSource(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="account">Paid from a bank / cash account</SelectItem>
                <SelectItem value="expense">Already booked as an expense — move it</SelectItem>
                <SelectItem value="payable">Bought on credit — supplier still to be paid</SelectItem>
                <SelectItem value="opening">Owned before Port Pal started</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {source === "account" && (
            <div>
              <Label>Account</Label>
              <Select value={accountId || undefined} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Pick account" /></SelectTrigger>
                <SelectContent>{(accounts ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {source === "expense" && (
            <div>
              <Label>The expense it was booked to</Label>
              <Select value={ledgerId || undefined} onValueChange={setLedgerId}>
                <SelectTrigger><SelectValue placeholder={expenses?.length ? "Pick the expense" : "No expense of that amount found"} /></SelectTrigger>
                <SelectContent>
                  {(expenses ?? []).map((x: any) => (
                    <SelectItem key={x.id} value={x.id}>
                      {String(x.transaction_date).slice(0, 10)} · {fmtMoney(x.debit_amount)} · {String(x.description ?? "").slice(0, 50)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()}
            disabled={save.isPending || !(Number(cost) > 0) || (source === "account" && !accountId) || (source === "expense" && !ledgerId)}>
            Post to books
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
