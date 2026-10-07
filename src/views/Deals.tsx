import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Handshake, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "@/lib/router";
import { format } from "date-fns";

const stageColor: Record<string, string> = {
  discovery: "bg-info/15 text-info",
  proposal: "bg-purple-100 text-purple-800",
  negotiation: "bg-warning/15 text-warning",
  won: "bg-success/15 text-success",
  lost: "bg-muted text-muted-foreground",
};

const STAGES = ["discovery", "proposal", "negotiation", "won", "lost"] as const;

export default function Deals() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", title: "", value: "", expected_close_date: "", notes: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: deals, isLoading } = useQuery({
    queryKey: ["deals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("deals").select("*, customers(company_name), leads(contact_name)").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, company_name").eq("is_active", true).order("company_name");
      if (error) throw error;
      return data;
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("deals").insert({
        customer_id: form.customer_id || null,
        title: form.title,
        value: parseFloat(form.value) || 0,
        expected_close_date: form.expected_close_date || null,
        notes: form.notes || null,
        created_by: user?.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      toast({ title: "Deal created" });
      setOpen(false);
      setForm({ customer_id: "", title: "", value: "", expected_close_date: "", notes: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStage = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: string }) => {
      const { error } = await supabase.from("deals").update({ stage } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["deals"] }); toast({ title: "Stage updated" }); },
  });

  const createQuote = useMutation({
    mutationFn: async (deal: any) => {
      const num = `QTE-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await supabase.from("quotes").insert({
        deal_id: deal.id,
        customer_id: deal.customer_id,
        quote_number: num,
        total_amount: deal.value || 0,
        created_by: user?.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Quote created from deal" });
      navigate("/quotes");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totalPipeline = deals?.filter((d: any) => !["won", "lost"].includes(d.stage)).reduce((s: number, d: any) => s + Number(d.value || 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Handshake className="h-6 w-6" />Deals</h1>
          <p className="text-muted-foreground">Pipeline value: {totalPipeline.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />New Deal</Button>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {STAGES.map((s) => (
          <Card key={s}>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground capitalize">{s}</p>
              <p className="text-2xl font-bold">{deals?.filter((d: any) => d.stage === s).length ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Close Date</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !deals?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No deals yet</TableCell></TableRow>
              ) : deals.map((d: any) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.title}</TableCell>
                  <TableCell>{d.customers?.company_name ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.leads?.contact_name ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(d.value).toLocaleString()}</TableCell>
                  <TableCell>
                    <Select value={d.stage} onValueChange={(v) => updateStage.mutate({ id: d.id, stage: v })}>
                      <SelectTrigger className="h-7 w-32"><Badge className={stageColor[d.stage] ?? ""} variant="secondary">{d.stage}</Badge></SelectTrigger>
                      <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs">{d.expected_close_date ? format(new Date(d.expected_close_date), "dd MMM yyyy") : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(d.created_at), "dd MMM yyyy")}</TableCell>
                  <TableCell>
                    {d.stage !== "lost" && d.customer_id && (
                      <Button size="sm" variant="outline" onClick={() => createQuote.mutate(d)}>
                        <FileText className="mr-1 h-3 w-3" />Quote
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Deal</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-4">
            <div className="space-y-2"><Label>Title *</Label><Input value={form.title} onChange={(e) => set("title", e.target.value)} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Customer</Label>
                <Select value={form.customer_id} onValueChange={(v) => set("customer_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{customers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Value</Label><Input type="number" value={form.value} onChange={(e) => set("value", e.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>Expected Close Date</Label><Input type="date" value={form.expected_close_date} onChange={(e) => set("expected_close_date", e.target.value)} /></div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
            <Button type="submit" className="w-full" disabled={createMut.isPending || !form.title}>Create Deal</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
