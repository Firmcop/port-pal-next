import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { CurrencySelect } from "@/components/CurrencySelect";
import { Plus, Trash2, ArrowLeftRight, RefreshCw } from "lucide-react";
import { revalueAcquisitionFx } from "@/lib/container-acquisition-edit";

import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function FxRates() {
  const { organizationId } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    currency_from: "USD",
    currency_to: "USD",
    rate: "",
    as_of_date: new Date().toISOString().slice(0, 10),
    source: "manual",
  });

  const { data: rates, isLoading } = useQuery({
    queryKey: ["fx-rates", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fx_rates" as any)
        .select("*")
        .eq("organization_id", organizationId!)
        .order("as_of_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const upsert = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fx_rates" as any).upsert(
        {
          organization_id: organizationId,
          currency_from: form.currency_from.toUpperCase(),
          currency_to: form.currency_to.toUpperCase(),
          rate: Number(form.rate),
          as_of_date: form.as_of_date,
          source: form.source || "manual",
        },
        { onConflict: "organization_id,currency_from,currency_to,as_of_date" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fx-rates"] });
      setOpen(false);
      setForm((f) => ({ ...f, rate: "" }));
      toast({ title: "FX rate saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fx_rates" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fx-rates"] }),
  });

  const revalue = useMutation({
    mutationFn: () => revalueAcquisitionFx(null, new Date().toISOString().slice(0, 10)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["container-acquisition-breakdown"] });
      qc.invalidateQueries({ queryKey: ["container-acquisition-audit"] });
      toast({
        title: `Revalued ${r.revalued} acquisition invoice${r.revalued === 1 ? "" : "s"}`,
        description: `${r.unchanged} already current · ${r.skipped} skipped · ${r.failed} failed — every change is in each container's acquisition history.`,
      });
    },
    onError: (e: any) => toast({ title: "Revaluation failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ArrowLeftRight className="h-6 w-6" />FX Rates</h1>
          <p className="text-muted-foreground">Exchange rates used when posting multi-currency ledger entries.</p>
        </div>
        <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => revalue.mutate()} disabled={revalue.isPending}>
          <RefreshCw className={`mr-1 h-4 w-4 ${revalue.isPending ? "animate-spin" : ""}`} />
          {revalue.isPending ? "Revaluing…" : "Revalue acquisition costs"}
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />Add Rate</Button></DialogTrigger>

          <DialogContent>
            <DialogHeader><DialogTitle>Add FX Rate</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>From</Label><CurrencySelect value={form.currency_from} onChange={(v) => setForm((f) => ({ ...f, currency_from: v }))} /></div>
              <div className="space-y-1"><Label>To</Label><CurrencySelect value={form.currency_to} onChange={(v) => setForm((f) => ({ ...f, currency_to: v }))} /></div>
              <div className="space-y-1"><Label>Rate</Label><Input type="number" step="0.000001" value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} /></div>
              <div className="space-y-1"><Label>As of</Label><Input type="date" value={form.as_of_date} onChange={(e) => setForm((f) => ({ ...f, as_of_date: e.target.value }))} /></div>
              <div className="space-y-1 col-span-2"><Label>Source</Label><Input value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} /></div>
            </div>
            <DialogFooter>
              <Button onClick={() => upsert.mutate()} disabled={!form.rate || upsert.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>


      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead><TableHead>To</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>As of</TableHead><TableHead>Source</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !rates?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No FX rates yet</TableCell></TableRow>
              ) : rates.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.currency_from}</TableCell>
                  <TableCell className="font-mono">{r.currency_to}</TableCell>
                  <TableCell className="text-right font-mono">{Number(r.rate).toFixed(6)}</TableCell>
                  <TableCell>{format(new Date(r.as_of_date), "yyyy-MM-dd")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.source ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
