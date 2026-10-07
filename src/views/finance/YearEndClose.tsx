import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance-format";

export default function YearEndClose() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [year, setYear] = useState<number>(new Date().getFullYear() - 1);
  const [retAcct, setRetAcct] = useState<string>("");

  const { data: accounts } = useQuery({
    queryKey: ["gl-accounts-equity"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gl_accounts" as any).select("id,code,name,type").eq("type", "equity").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: closes } = useQuery({
    queryKey: ["year-end-closes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("year_end_closes" as any).select("*").order("fiscal_year", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const close = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("close_fiscal_year" as any, { _fiscal_year: year, _retained_earnings_account: retAcct });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["year-end-closes"] }); toast({ title: `Year ${year} closed` }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Lock className="h-6 w-6" />Year-End Close</h1>
        <p className="text-muted-foreground">Roll P&amp;L net income into retained earnings and lock all periods for the year.</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Fiscal year</Label>
              <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
            </div>
            <div className="md:col-span-2">
              <Label>Retained earnings account</Label>
              <Select value={retAcct} onValueChange={setRetAcct}>
                <SelectTrigger><SelectValue placeholder="Select equity account" /></SelectTrigger>
                <SelectContent>
                  {accounts?.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button disabled={!retAcct || close.isPending} onClick={() => close.mutate()}>Close fiscal year</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 font-semibold border-b">Closed years</div>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Year</TableHead><TableHead>Closed at</TableHead><TableHead className="text-right">Net Income</TableHead><TableHead>Notes</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {!closes?.length ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No closes yet.</TableCell></TableRow>
              ) : closes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono">{c.fiscal_year}</TableCell>
                  <TableCell className="text-xs">{new Date(c.closed_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(c.net_income)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
