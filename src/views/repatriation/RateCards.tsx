import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Ban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { getOrgCurrency } from "@/lib/app-settings";

type RateCard = {
  id: string;
  origin: string;
  destination: string;
  container_size: string;
  shipping_line: string | null;
  rate_amount: number;
  handling_fee: number;
  transfer_fee: number;
  currency: string | null;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  notes: string | null;
};

const emptyForm = {
  id: "",
  origin: "",
  destination: "",
  container_size: "20",
  shipping_line: "",
  rate_amount: "",
  handling_fee: "30",
  transfer_fee: "0",
  currency: "USD",
  effective_from: new Date().toISOString().slice(0, 10),
  effective_to: "",
  notes: "",
};

export default function RepatRateCards() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const { data: cards, isLoading } = useQuery({
    queryKey: ["repat-rate-cards"],
    queryFn: async (): Promise<RateCard[]> => {
      const { data, error } = await (supabase as any)
        .from("repat_rate_cards")
        .select("*")
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        origin: form.origin.trim(),
        destination: form.destination.trim(),
        container_size: form.container_size,
        shipping_line: form.shipping_line.trim() || null,
        rate_amount: Number(form.rate_amount) || 0,
        handling_fee: Number(form.handling_fee) || 0,
        transfer_fee: Number(form.transfer_fee) || 0,
        currency: form.currency || getOrgCurrency(),
        effective_from: form.effective_from,
        effective_to: form.effective_to || null,
        notes: form.notes.trim() || null,
      };
      if (form.id) {
        const { error } = await (supabase as any).from("repat_rate_cards").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("repat_rate_cards").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repat-rate-cards"] });
      toast({ title: form.id ? "Rate card updated" : "Rate card added" });
      setOpen(false);
      setForm({ ...emptyForm });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const expire = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("repat_rate_cards")
        .update({ is_active: false, effective_to: new Date().toISOString().slice(0, 10) })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repat-rate-cards"] });
      toast({ title: "Rate card expired" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openEdit = (c: RateCard) => {
    setForm({
      id: c.id,
      origin: c.origin,
      destination: c.destination,
      container_size: c.container_size,
      shipping_line: c.shipping_line ?? "",
      rate_amount: String(c.rate_amount ?? ""),
      handling_fee: String(c.handling_fee ?? "30"),
      transfer_fee: String(c.transfer_fee ?? "0"),
      currency: c.currency ?? "USD",
      effective_from: c.effective_from,
      effective_to: c.effective_to ?? "",
      notes: c.notes ?? "",
    });
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Repatriation Rate Cards</h1>
          <p className="text-muted-foreground">Route pricing used when repatriating containers to a depot.</p>
        </div>
        <Button size="sm" onClick={() => { setForm({ ...emptyForm }); setOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> New rate card
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Rates</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Route</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Shipping line</TableHead>
                  <TableHead className="text-right">Repat rate</TableHead>
                  <TableHead className="text-right">Handling</TableHead>
                  <TableHead className="text-right">Transfer</TableHead>
                  <TableHead>Valid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableSkeleton columns={9} />
                ) : !cards?.length ? (
                  <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No rate cards yet.</TableCell></TableRow>
                ) : (
                  cards.map((c) => (
                    <TableRow key={c.id} className={c.is_active ? "" : "opacity-60"}>
                      <TableCell className="font-medium">{c.origin} → {c.destination}</TableCell>
                      <TableCell>{c.container_size}'</TableCell>
                      <TableCell className="text-muted-foreground">{c.shipping_line || "Any"}</TableCell>
                      <TableCell className="text-right font-mono">{c.currency} {Number(c.rate_amount).toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{c.currency} {Number(c.handling_fee).toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{c.currency} {Number(c.transfer_fee ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(c.effective_from), "dd MMM yyyy")}
                        {c.effective_to ? ` – ${format(new Date(c.effective_to), "dd MMM yyyy")}` : " – open"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={c.is_active ? "bg-success/15 text-success border-success/30" : ""}>
                          {c.is_active ? "Active" : "Expired"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                        {c.is_active && (
                          <Button variant="ghost" size="icon" onClick={() => expire.mutate(c.id)} title="Expire">
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? "Edit rate card" : "New rate card"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Origin *</Label><Input value={form.origin} onChange={(e) => set("origin", e.target.value)} placeholder="Nairobi" /></div>
              <div><Label>Destination *</Label><Input value={form.destination} onChange={(e) => set("destination", e.target.value)} placeholder="Multiple Depot Kampala" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Container size *</Label>
                <Select value={form.container_size} onValueChange={(v) => set("container_size", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["10", "20", "30", "40", "45"].map((s) => <SelectItem key={s} value={s}>{s}'</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Shipping line (optional)</Label><Input value={form.shipping_line} onChange={(e) => set("shipping_line", e.target.value)} placeholder="Any line" /></div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div><Label>Repat rate *</Label><Input type="number" step="0.01" value={form.rate_amount} onChange={(e) => set("rate_amount", e.target.value)} /></div>
              <div><Label>Handling fee</Label><Input type="number" step="0.01" value={form.handling_fee} onChange={(e) => set("handling_fee", e.target.value)} /></div>
              <div><Label>Transfer fee</Label><Input type="number" step="0.01" value={form.transfer_fee} onChange={(e) => set("transfer_fee", e.target.value)} /></div>
              <div><Label>Currency</Label><Input value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Effective from *</Label><Input type="date" value={form.effective_from} onChange={(e) => set("effective_from", e.target.value)} /></div>
              <div><Label>Effective to</Label><Input type="date" value={form.effective_to} onChange={(e) => set("effective_to", e.target.value)} /></div>
            </div>
            <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.origin.trim() || !form.destination.trim() || !form.rate_amount}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
