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
import { Plus, UserPlus, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "@/lib/router";
import { format } from "date-fns";
import { useOrgCurrency } from "@/hooks/use-org-currency";

const statusColor: Record<string, string> = {
  new: "bg-info/15 text-info",
  contacted: "bg-warning/15 text-warning",
  qualified: "bg-success/15 text-success",
  lost: "bg-muted text-muted-foreground",
};

const SOURCES = ["website", "referral", "walk_in", "other"] as const;

export default function Leads() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { currency: orgCurrency } = useOrgCurrency();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ contact_name: "", contact_email: "", contact_phone: "", source: "walk_in", notes: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: leads, isLoading } = useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*, customers(company_name)").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("leads").insert({
        contact_name: form.contact_name,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        source: form.source,
        notes: form.notes || null,
        created_by: user?.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast({ title: "Lead created" });
      setOpen(false);
      setForm({ contact_name: "", contact_email: "", contact_phone: "", source: "walk_in", notes: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("leads").update({ status } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leads"] }); toast({ title: "Status updated" }); },
  });

  const convertToDeal = useMutation({
    mutationFn: async (lead: any) => {
      // Create customer first if not linked
      let customerId = lead.customer_id;
      if (!customerId) {
        const { data: cust, error: custErr } = await supabase.from("customers").insert({
          company_name: lead.contact_name,
          customer_type: "buyer" as any,
          contact_person: lead.contact_name,
          email: lead.contact_email,
          phone: lead.contact_phone,
          currency: orgCurrency,
          created_by: user?.id,
        }).select("id").single();
        if (custErr) throw custErr;
        customerId = cust.id;
        await supabase.from("leads").update({ customer_id: customerId, status: "qualified" } as any).eq("id", lead.id);
      }
      // Create deal
      const { error } = await supabase.from("deals").insert({
        lead_id: lead.id,
        customer_id: customerId,
        title: `Deal from ${lead.contact_name}`,
        created_by: user?.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast({ title: "Deal created from lead" });
      navigate("/deals");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><UserPlus className="h-6 w-6" />Leads</h1>
          <p className="text-muted-foreground">Track potential customers and convert to deals</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />New Lead</Button>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-4 gap-3">
        {["new", "contacted", "qualified", "lost"].map((s) => (
          <Card key={s}>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground capitalize">{s}</p>
              <p className="text-2xl font-bold">{leads?.filter((l: any) => l.status === s).length ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !leads?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No leads yet</TableCell></TableRow>
              ) : leads.map((l: any) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.contact_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{l.contact_email ?? "—"}</TableCell>
                  <TableCell className="text-sm">{l.contact_phone ?? "—"}</TableCell>
                  <TableCell className="capitalize text-sm">{l.source?.replace("_", " ")}</TableCell>
                  <TableCell>
                    <Select value={l.status} onValueChange={(v) => updateStatus.mutate({ id: l.id, status: v })}>
                      <SelectTrigger className="h-7 w-28"><Badge className={statusColor[l.status] ?? ""} variant="secondary">{l.status}</Badge></SelectTrigger>
                      <SelectContent>
                        {["new", "contacted", "qualified", "lost"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(l.created_at), "dd MMM yyyy")}</TableCell>
                  <TableCell>
                    {l.status !== "lost" && (
                      <Button size="sm" variant="outline" onClick={() => convertToDeal.mutate(l)}>
                        <ArrowRight className="mr-1 h-3 w-3" />Deal
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
          <DialogHeader><DialogTitle>New Lead</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-4">
            <div className="space-y-2"><Label>Contact Name *</Label><Input value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} /></div>
            </div>
            <div className="space-y-2">
              <Label>Source</Label>
              <Select value={form.source} onValueChange={(v) => set("source", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
            <Button type="submit" className="w-full" disabled={createMut.isPending || !form.contact_name}>Create Lead</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
