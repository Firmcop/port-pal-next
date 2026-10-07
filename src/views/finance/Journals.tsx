import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, BookText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fmtMoney, getDefaultCurrency } from "@/lib/finance-format";

type Line = { gl_account_id: string; debit: string; credit: string; description: string };

const emptyLine = (): Line => ({ gl_account_id: "", debit: "", credit: "", description: "" });

export default function Journals() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [currency, setCurrency] = useState(getDefaultCurrency());
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);

  const { data: accounts } = useQuery({
    queryKey: ["gl-accounts-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gl_accounts" as any).select("id,code,name,account_type").eq("is_active", true).order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: journals } = useQuery({
    queryKey: ["manual-journals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounting_transactions")
        .select("id, transaction_number, transaction_date, description, debit_amount, credit_amount, journal_id, gl_account_id, currency")
        .eq("reference_type", "manual_journal")
        .order("transaction_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as any[];
    },
  });

  const groupedJournals = useMemo(() => {
    const map = new Map<string, any[]>();
    (journals ?? []).forEach((t) => {
      const k = t.journal_id ?? t.id;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    });
    return Array.from(map.entries());
  }, [journals]);

  const totals = useMemo(() => {
    let d = 0, c = 0;
    lines.forEach((l) => { d += Number(l.debit || 0); c += Number(l.credit || 0); });
    return { debit: d, credit: c, balanced: Math.abs(d - c) < 0.005 && d > 0 };
  }, [lines]);

  const post = useMutation({
    mutationFn: async () => {
      const payload = lines
        .filter((l) => l.gl_account_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
        .map((l) => ({
          gl_account_id: l.gl_account_id,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
          description: l.description || null,
        }));
      const { error } = await supabase.rpc("post_journal" as any, {
        _entry_date: new Date(entryDate).toISOString(),
        _description: description,
        _reference: reference || null,
        _currency: currency,
        _lines: payload,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["manual-journals"] });
      qc.invalidateQueries({ queryKey: ["accounting-transactions"] });
      qc.invalidateQueries({ queryKey: ["account-balances"] });
      setOpen(false);
      setLines([emptyLine(), emptyLine()]);
      setDescription(""); setReference("");
      toast({ title: "Journal posted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BookText className="h-6 w-6" />Manual Journals</h1>
          <p className="text-muted-foreground">Post balanced multi-line journal entries.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> New journal</Button></DialogTrigger>
          <DialogContent className="max-w-4xl">
            <DialogHeader><DialogTitle>New journal entry</DialogTitle></DialogHeader>
            <div className="grid grid-cols-4 gap-3">
              <div><Label>Date</Label><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
              <div><Label>Reference</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional" /></div>
              <div><Label>Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
              <div className="col-span-1"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="w-32">Debit</TableHead>
                  <TableHead className="w-32">Credit</TableHead>
                  <TableHead>Memo</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Select value={l.gl_account_id} onValueChange={(v) => setLines(lines.map((x, j) => j === i ? { ...x, gl_account_id: v } : x))}>
                        <SelectTrigger><SelectValue placeholder="Select account..." /></SelectTrigger>
                        <SelectContent>
                          {(accounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.debit} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, debit: e.target.value, credit: e.target.value ? "" : x.credit } : x))} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.credit} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, credit: e.target.value, debit: e.target.value ? "" : x.debit } : x))} /></TableCell>
                    <TableCell><Input value={l.description} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} /></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => setLines(lines.length > 2 ? lines.filter((_, j) => j !== i) : lines)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between text-sm">
              <Button variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine()])}><Plus className="h-3 w-3 mr-1" />Add line</Button>
              <div className="space-x-4 font-mono">
                <span>Dr: {fmtMoney(totals.debit)}</span>
                <span>Cr: {fmtMoney(totals.credit)}</span>
                <span className={totals.balanced ? "text-success" : "text-destructive"}>
                  {totals.balanced ? "Balanced" : `Off by ${fmtMoney(totals.debit - totals.credit)}`}
                </span>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => post.mutate()} disabled={!totals.balanced || post.isPending}>Post journal</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-base">Recent journals</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!groupedJournals.length ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No manual journals yet.</TableCell></TableRow>
              ) : groupedJournals.map(([jid, ls]) => {
                const totD = ls.reduce((s, l) => s + Number(l.debit_amount || 0), 0);
                const totC = ls.reduce((s, l) => s + Number(l.credit_amount || 0), 0);
                return (
                  <TableRow key={jid}>
                    <TableCell className="text-xs">{format(new Date(ls[0].transaction_date), "yyyy-MM-dd")}</TableCell>
                    <TableCell className="font-mono text-xs">{ls[0].transaction_number?.split("-").slice(0, 3).join("-")}</TableCell>
                    <TableCell className="text-sm">{ls[0].description} <span className="text-muted-foreground">({ls.length} lines)</span></TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(totD)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(totC)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
