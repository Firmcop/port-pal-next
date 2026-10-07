import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, AlarmClock, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CHANNELS = ["email", "whatsapp", "sms"] as const;

export default function DunningRules() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", days_after_due: 7, channel: "email", template: "Friendly reminder: invoice {invoice_number} is overdue." });

  const { data: rules } = useQuery({
    queryKey: ["dunning-rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("dunning_rules" as any).select("*").order("days_after_due");
      if (error) throw error;
      return data as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("dunning_rules" as any).insert({ ...form, organization_id: org.organizationId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dunning-rules"] }); setOpen(false); toast({ title: "Rule created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("dunning_rules" as any).update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dunning-rules"] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dunning_rules" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dunning-rules"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><AlarmClock className="h-6 w-6" />Dunning Rules</h1>
          <p className="text-muted-foreground">Automatic reminder cadence for overdue invoices.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New rule</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New dunning rule</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Days after due</Label><Input type="number" min={0} value={form.days_after_due} onChange={(e) => setForm({ ...form, days_after_due: Number(e.target.value) })} /></div>
              <div>
                <Label>Channel</Label>
                <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Message template</Label><Textarea rows={4} value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Days after due</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rules?.length ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No rules yet.</TableCell></TableRow>
              ) : rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>+{r.days_after_due} d</TableCell>
                  <TableCell><Badge variant="secondary">{r.channel}</Badge></TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: r.id, is_active: !r.is_active })}>
                      {r.is_active ? "Active" : "Paused"}
                    </Button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}><Trash2 className="h-3 w-3" /></Button>
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
