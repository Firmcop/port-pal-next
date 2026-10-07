import { useMemo, useState } from "react";
import { Link, useParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, UserCog, Wrench, PackageMinus, Plus, PackageCheck, PackageOpen, ShieldCheck } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtMoney } from "@/lib/finance-format";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import { ChargebackPanel } from "@/components/assets/ChargebackPanel";

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();
  const org = useOrganization();

  const { data: asset } = useQuery({
    queryKey: ["asset", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("fixed_assets" as any)
        .select("*, depots(id,name), employees:custodian_employee_id(id,name)")
        .eq("id", id).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: history } = useQuery({
    queryKey: ["asset-history", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("asset_assignments" as any)
      .select("*, from_e:from_employee_id(name), to_e:to_employee_id(name), from_d:from_depot_id(name), to_d:to_depot_id(name)")
      .eq("asset_id", id).order("effective_at", { ascending: false })).data ?? [],
  });

  const { data: plans } = useQuery({
    queryKey: ["asset-plans", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("asset_maintenance_plans" as any).select("*").eq("asset_id", id).order("next_due_at")).data ?? [],
  });

  const { data: workOrders } = useQuery({
    queryKey: ["asset-wos", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("work_orders").select("id, wo_number, status, created_at").eq("asset_id", id).order("created_at", { ascending: false })).data ?? [],
  });

  const { data: disposals } = useQuery({
    queryKey: ["asset-disposals", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("asset_disposals" as any).select("*").eq("asset_id", id).order("created_at", { ascending: false })).data ?? [],
  });

  const { data: issues, refetch: refetchIssues } = useQuery({
    queryKey: ["asset-issues", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("asset_issues" as any)
      .select("*, emp:issued_to_employee_id(name), cust:issued_to_customer_id(name)")
      .eq("asset_id", id).order("issued_at", { ascending: false })).data ?? [],
  });
  const openIssue: any = (issues ?? []).find((i: any) => i.status === "open");

  const { data: depots } = useQuery({ queryKey: ["depots-pick"], queryFn: async () => (await supabase.from("depots").select("id,name").order("name")).data ?? [] });
  const { data: employees } = useQuery({ queryKey: ["employees-pick"], queryFn: async () => (await supabase.from("employees").select("id,name").eq("is_active", true).order("name")).data ?? [] });
  const { data: customers } = useQuery({ queryKey: ["customers-pick"], queryFn: async () => (await supabase.from("customers").select("id,name,currency").order("name")).data ?? [] });

  const [assignOpen, setAssignOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);




  const reassign = useMutation({
    mutationFn: async (payload: { depot_id: string | null; custodian_employee_id: string | null }) => {
      const { error } = await supabase.from("fixed_assets" as any).update(payload).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset", id] });
      qc.invalidateQueries({ queryKey: ["asset-history", id] });
      setAssignOpen(false);
      toast({ title: "Assignment updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const nbv = asset ? Number(asset.cost || 0) - Number(asset.accumulated_depreciation || 0) : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/assets" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Back to register
        </Link>
      </div>

      {!asset ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <span className="font-mono text-sm">{asset.code}</span>
                    <span>—</span>
                    <span>{asset.name}</span>
                  </CardTitle>
                  <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-2">
                    <Badge variant="outline">{asset.asset_class}</Badge>
                    <Badge variant={asset.status === "disposed" ? "destructive" : "secondary"}>{asset.status}</Badge>
                    <span>Condition: {asset.condition}</span>
                    {asset.tag_number && <span>· Tag: {asset.tag_number}</span>}
                    {asset.is_issuable && <Badge variant="outline" className="text-xs">Issuable</Badge>}
                    {openIssue && <Badge className="bg-amber-500 text-white">Currently issued to {openIssue.emp?.name || openIssue.cust?.name || openIssue.issued_to_name || "—"}</Badge>}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {asset.is_issuable && asset.status !== "disposed" && (
                    openIssue
                      ? <Button size="sm" onClick={() => setReturnOpen(true)}><PackageCheck className="h-4 w-4 mr-1" />Return</Button>
                      : <Button size="sm" onClick={() => setIssueOpen(true)}><PackageOpen className="h-4 w-4 mr-1" />Issue</Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}><UserCog className="h-4 w-4 mr-1" />Reassign</Button>
                  <Button size="sm" variant="outline" onClick={() => setPlanOpen(true)}><Wrench className="h-4 w-4 mr-1" />Add plan</Button>
                  {asset.status !== "disposed" && (
                    <Button size="sm" variant="destructive" onClick={() => setDisposeOpen(true)}><PackageMinus className="h-4 w-4 mr-1" />Dispose</Button>
                  )}
                </div>

              </div>
            </CardHeader>
            <CardContent className="grid md:grid-cols-4 gap-4 text-sm">
              <Field label="Depot" value={asset.depots?.name || "—"} />
              <Field label="Custodian" value={asset.employees?.name || "—"} />
              <Field label="Serial" value={asset.serial_number || "—"} />
              <Field label="Manufacturer / Model" value={[asset.manufacturer, asset.model].filter(Boolean).join(" ") || "—"} />
              <Field label="Cost" value={fmtMoney(asset.cost)} />
              <Field label="Accum. Depreciation" value={fmtMoney(asset.accumulated_depreciation)} />
              <Field label="NBV" value={<span className="font-bold">{fmtMoney(nbv)}</span>} />
              <Field label="Method" value={asset.method} />
              <Field label="Warranty" value={asset.warranty_expiry || "—"} />
              <Field label="Next service" value={asset.next_service_at || "—"} />
              <Field label="Life (months)" value={asset.useful_life_months} />
              <Field label="Salvage" value={fmtMoney(asset.salvage_value)} />
            </CardContent>
          </Card>

          <Tabs defaultValue={openIssue ? "issues" : "history"}>
            <TabsList>
              <TabsTrigger value="history">Custodian history</TabsTrigger>
              {asset.is_issuable && <TabsTrigger value="issues">Issues & Returns</TabsTrigger>}
              {asset.is_issuable && <TabsTrigger value="chargebacks">Chargebacks</TabsTrigger>}
              <TabsTrigger value="maintenance">Maintenance plans</TabsTrigger>
              <TabsTrigger value="wos">Work orders</TabsTrigger>
              <TabsTrigger value="disposal">Disposal</TabsTrigger>
            </TabsList>

            <TabsContent value="history">
              <Card><CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>When</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Depot from → to</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {!history?.length ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No transfers.</TableCell></TableRow>
                    ) : history.map((h: any) => (
                      <TableRow key={h.id}>
                        <TableCell className="text-xs">{new Date(h.effective_at).toLocaleString()}</TableCell>
                        <TableCell>{h.from_e?.name || "—"}</TableCell>
                        <TableCell>{h.to_e?.name || "—"}</TableCell>
                        <TableCell className="text-xs">{h.from_d?.name || "—"} → {h.to_d?.name || "—"}</TableCell>
                        <TableCell className="text-xs">{h.notes}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="issues">
              <Card><CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Issued</TableHead><TableHead>To</TableHead><TableHead>Purpose</TableHead>
                    <TableHead>Expected back</TableHead><TableHead>Returned</TableHead>
                    <TableHead>Out / In</TableHead><TableHead className="text-right">Charge</TableHead>
                    <TableHead>Status</TableHead><TableHead>Chargeback</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {!issues?.length ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">No issues yet. {asset.is_issuable ? "Use Issue to check out this asset." : "Mark asset as Issuable to enable checkout."}</TableCell></TableRow>
                    ) : issues.map((i: any) => (
                      <TableRow key={i.id}>
                        <TableCell className="text-xs">{new Date(i.issued_at).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{i.emp?.name || i.cust?.name || i.issued_to_name || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{i.purpose}</TableCell>
                        <TableCell className="text-xs">{i.expected_return_at ? new Date(i.expected_return_at).toLocaleDateString() : "—"}</TableCell>
                        <TableCell className="text-xs">{i.returned_at ? new Date(i.returned_at).toLocaleString() : "—"}</TableCell>
                        <TableCell className="text-xs">{i.condition_out} → {i.condition_in || "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{i.damage_charge_amount ? fmtMoney(i.damage_charge_amount) : "—"}</TableCell>
                        <TableCell><Badge variant={i.status === "open" ? "default" : i.status === "returned" ? "secondary" : "destructive"}>{i.status}</Badge></TableCell>
                        <TableCell className="text-xs">
                          {i.chargeback_status && i.chargeback_status !== "none"
                            ? <Badge variant="outline">{i.chargeback_status.replace(/_/g, " ")}</Badge>
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="chargebacks">
              <div className="space-y-4">
                {(issues ?? []).filter((i: any) => i.status === "damaged" || i.status === "lost" || (i.chargeback_status && i.chargeback_status !== "none")).length === 0 ? (
                  <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">
                    <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    No chargebacks. Damaged or lost returns will surface here for approval and settlement.
                  </CardContent></Card>
                ) : (issues ?? [])
                  .filter((i: any) => i.status === "damaged" || i.status === "lost" || (i.chargeback_status && i.chargeback_status !== "none"))
                  .map((i: any) => (
                    <ChargebackPanel key={i.id} issue={i} onChanged={() => refetchIssues()} />
                  ))}
              </div>
            </TabsContent>


            <TabsContent value="maintenance">
              <Card><CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Plan</TableHead><TableHead>Frequency</TableHead><TableHead>Next due</TableHead><TableHead>Last done</TableHead><TableHead>Active</TableHead><TableHead></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {!plans?.length ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No plans yet.</TableCell></TableRow>
                    ) : plans.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.name}</TableCell>
                        <TableCell className="text-xs">{p.frequency}{p.frequency==='custom_days' && ` (${p.interval_days}d)`}</TableCell>
                        <TableCell className="font-mono text-xs">{p.next_due_at}</TableCell>
                        <TableCell className="font-mono text-xs">{p.last_done_at || "—"}</TableCell>
                        <TableCell>{p.is_active ? "Yes" : "No"}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={async () => {
                            await supabase.rpc("advance_maintenance_plan" as any, { _plan_id: p.id });
                            qc.invalidateQueries({ queryKey: ["asset-plans", id] });
                            toast({ title: "Marked done, next due advanced" });
                          }}>Mark done</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="wos">
              <Card><CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>WO#</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {!workOrders?.length ? (
                      <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No work orders on this asset.</TableCell></TableRow>
                    ) : workOrders.map((w: any) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-mono text-xs">{w.wo_number}</TableCell>
                        <TableCell><Badge variant="outline">{w.status}</Badge></TableCell>
                        <TableCell className="text-xs">{new Date(w.created_at).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="disposal">
              <Card><CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Proceeds</TableHead><TableHead className="text-right">NBV</TableHead><TableHead className="text-right">Gain / Loss</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {!disposals?.length ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No disposal recorded.</TableCell></TableRow>
                    ) : disposals.map((d: any) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-xs">{d.disposed_on}</TableCell>
                        <TableCell>{d.method}</TableCell>
                        <TableCell className="text-right font-mono">{fmtMoney(d.proceeds)}</TableCell>
                        <TableCell className="text-right font-mono">{d.nbv_at_disposal != null ? fmtMoney(d.nbv_at_disposal) : "—"}</TableCell>
                        <TableCell className={`text-right font-mono ${Number(d.gain_loss) < 0 ? "text-destructive" : ""}`}>{d.gain_loss != null ? fmtMoney(d.gain_loss) : "—"}</TableCell>
                        <TableCell><Badge>{d.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>
          </Tabs>

          <ReassignDialog open={assignOpen} onOpenChange={setAssignOpen} depots={depots ?? []} employees={employees ?? []} initial={asset} onSave={(v) => reassign.mutate(v)} pending={reassign.isPending} />
          <PlanDialog open={planOpen} onOpenChange={setPlanOpen} assetId={id!} orgId={org.organizationId} onDone={() => qc.invalidateQueries({ queryKey: ["asset-plans", id] })} />
          <DisposeDialog open={disposeOpen} onOpenChange={setDisposeOpen} asset={asset} customers={customers ?? []} orgId={org.organizationId} onDone={() => {
            qc.invalidateQueries({ queryKey: ["asset", id] });
            qc.invalidateQueries({ queryKey: ["asset-disposals", id] });
          }} />
          <IssueDialog open={issueOpen} onOpenChange={setIssueOpen} assetId={id!} employees={employees ?? []} customers={customers ?? []} onDone={() => refetchIssues()} />
          <ReturnDialog open={returnOpen} onOpenChange={setReturnOpen} issue={openIssue} employees={employees ?? []} onDone={() => { refetchIssues(); qc.invalidateQueries({ queryKey: ["asset", id] }); }} />
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function ReassignDialog({ open, onOpenChange, depots, employees, initial, onSave, pending }: any) {
  const [depot, setDepot] = useState<string>(initial?.depot_id || "");
  const [custodian, setCustodian] = useState<string>(initial?.custodian_employee_id || "");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reassign asset</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Depot</Label>
            <Select value={depot || "none"} onValueChange={(v) => setDepot(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {depots.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Custodian</Label>
            <Select value={custodian || "none"} onValueChange={(v) => setCustodian(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {employees.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave({ depot_id: depot || null, custodian_employee_id: custodian || null })} disabled={pending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanDialog({ open, onOpenChange, assetId, orgId, onDone }: any) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({ name: "", frequency: "monthly", interval_days: 30, next_due_at: new Date().toISOString().slice(0,10), task_template: "" });
  const save = async () => {
    const { error } = await supabase.from("asset_maintenance_plans" as any).insert({ ...form, asset_id: assetId, organization_id: orgId, is_active: true });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    onDone(); onOpenChange(false); toast({ title: "Plan created" });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Preventive maintenance plan</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Oil change, Inspection, etc." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Frequency</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["daily","weekly","monthly","quarterly","annually","custom_days"].map((f) => <SelectItem key={f} value={f}>{f.replace("_"," ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Interval (days)</Label><Input type="number" value={form.interval_days} onChange={(e) => setForm({ ...form, interval_days: Number(e.target.value) })} disabled={form.frequency !== "custom_days"} /></div>
          </div>
          <div><Label>Next due</Label><Input type="date" value={form.next_due_at} onChange={(e) => setForm({ ...form, next_due_at: e.target.value })} /></div>
          <div><Label>Task template</Label><Input value={form.task_template} onChange={(e) => setForm({ ...form, task_template: e.target.value })} placeholder="Optional description" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!form.name}>Create plan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisposeDialog({ open, onOpenChange, asset, customers, orgId, onDone }: any) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({ method: "sale", disposed_on: new Date().toISOString().slice(0,10), buyer_customer_id: "", proceeds: 0, notes: "" });
  const nbv = Number(asset?.cost || 0) - Number(asset?.accumulated_depreciation || 0);
  const gainLoss = Number(form.proceeds || 0) - nbv;
  const save = async () => {
    const { data, error } = await supabase.from("asset_disposals" as any).insert({
      ...form,
      buyer_customer_id: form.buyer_customer_id || null,
      asset_id: asset.id,
      organization_id: orgId,
      status: "draft",
    }).select("id").single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    const { error: perr } = await supabase.rpc("post_asset_disposal" as any, { _disposal_id: (data as any).id });
    if (perr) { toast({ title: "Error posting", description: perr.message, variant: "destructive" }); return; }
    onDone(); onOpenChange(false); toast({ title: "Asset disposed" });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Dispose asset</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Method</Label>
              <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["sale","scrap","donation","write_off","lost"].map((m) => <SelectItem key={m} value={m}>{m.replace("_"," ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Date</Label><Input type="date" value={form.disposed_on} onChange={(e) => setForm({ ...form, disposed_on: e.target.value })} /></div>
          </div>
          {form.method === "sale" && (
            <div>
              <Label>Buyer</Label>
              <Select value={form.buyer_customer_id || "none"} onValueChange={(v) => setForm({ ...form, buyer_customer_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div><Label>Proceeds</Label><Input type="number" step="0.01" value={form.proceeds} onChange={(e) => setForm({ ...form, proceeds: Number(e.target.value) })} /></div>
          <div className="text-sm bg-muted/30 p-3 rounded">
            <div>NBV: <span className="font-mono">{fmtMoney(nbv)}</span></div>
            <div>Gain / Loss on disposal: <span className={`font-mono ${gainLoss < 0 ? "text-destructive" : "text-green-600"}`}>{fmtMoney(gainLoss)}</span></div>
          </div>
          <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} variant="destructive">Dispose &amp; post</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueDialog({ open, onOpenChange, assetId, employees, customers, onDone }: any) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({
    issued_to_employee_id: "", issued_to_customer_id: "", issued_to_name: "",
    expected_return_at: "", purpose: "", condition_out: "good", condition_out_notes: "",
  });
  const save = async () => {
    const { error } = await supabase.rpc("issue_asset" as any, {
      p_asset_id: assetId,
      p_issued_to_employee_id: form.issued_to_employee_id || null,
      p_issued_to_name: form.issued_to_name || null,
      p_issued_to_customer_id: form.issued_to_customer_id || null,
      p_expected_return_at: form.expected_return_at || null,
      p_purpose: form.purpose || null,
      p_work_order_id: null,
      p_condition_out: form.condition_out,
      p_condition_out_notes: form.condition_out_notes || null,
      p_photos_out: [],
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    onDone(); onOpenChange(false); toast({ title: "Asset issued" });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Issue asset</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Issue to employee</Label>
            <Select value={form.issued_to_employee_id || "none"} onValueChange={(v) => setForm({ ...form, issued_to_employee_id: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {employees.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>…or customer / subcontractor</Label>
              <Select value={form.issued_to_customer_id || "none"} onValueChange={(v) => setForm({ ...form, issued_to_customer_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Free-text name</Label><Input value={form.issued_to_name} onChange={(e) => setForm({ ...form, issued_to_name: e.target.value })} placeholder="If not in registry" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Expected return</Label><Input type="datetime-local" value={form.expected_return_at} onChange={(e) => setForm({ ...form, expected_return_at: e.target.value })} /></div>
            <div>
              <Label>Condition on issue</Label>
              <Select value={form.condition_out} onValueChange={(v) => setForm({ ...form, condition_out: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["new","good","fair","poor"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Purpose</Label><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. grinding fabrication panels" /></div>
          <div><Label>Condition notes</Label><Textarea rows={2} value={form.condition_out_notes} onChange={(e) => setForm({ ...form, condition_out_notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Issue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnDialog({ open, onOpenChange, issue, employees, onDone }: any) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({
    condition_in: "good", condition_in_notes: "", received_by_employee_id: "",
    mark_lost: false, damage_charge: 0,
  });
  if (!issue) return null;
  const rank = (c: string) => ({ new: 4, good: 3, fair: 2, poor: 1 } as any)[c] ?? 0;
  const worse = rank(form.condition_in) < rank(issue.condition_out);
  const save = async () => {
    const { error } = await supabase.rpc("return_asset" as any, {
      p_issue_id: issue.id,
      p_condition_in: form.condition_in,
      p_condition_in_notes: form.condition_in_notes || null,
      p_photos_in: [],
      p_received_by_employee_id: form.received_by_employee_id || null,
      p_mark_lost: form.mark_lost,
      p_damage_charge: (worse || form.mark_lost) && form.damage_charge > 0 ? form.damage_charge : null,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    onDone(); onOpenChange(false); toast({ title: form.mark_lost ? "Marked as lost" : "Return recorded" });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Return asset</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs bg-muted/40 p-2 rounded">
            Issued {new Date(issue.issued_at).toLocaleString()} — condition on issue: <span className="font-semibold">{issue.condition_out}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Condition on return</Label>
              <Select value={form.condition_in} onValueChange={(v) => setForm({ ...form, condition_in: v })} disabled={form.mark_lost}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["new","good","fair","poor"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Received by</Label>
              <Select value={form.received_by_employee_id || "none"} onValueChange={(v) => setForm({ ...form, received_by_employee_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {employees.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Notes</Label><Textarea rows={2} value={form.condition_in_notes} onChange={(e) => setForm({ ...form, condition_in_notes: e.target.value })} /></div>
          <div className="flex items-center gap-2">
            <Checkbox id="lost" checked={form.mark_lost} onCheckedChange={(v) => setForm({ ...form, mark_lost: !!v })} />
            <Label htmlFor="lost" className="cursor-pointer">Not returned — mark as lost</Label>
          </div>
          {(worse || form.mark_lost) && (
            <div className="border rounded p-3 space-y-2 bg-destructive/5">
              <div className="text-sm font-medium text-destructive">
                {form.mark_lost ? "Loss — chargeback" : "Condition worse than at issue — damage chargeback"}
              </div>
              <div>
                <Label>Charge to {issue.emp?.name || issue.cust?.name || issue.issued_to_name}</Label>
                <Input type="number" step="0.01" value={form.damage_charge} onChange={(e) => setForm({ ...form, damage_charge: Number(e.target.value) })} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} variant={form.mark_lost ? "destructive" : "default"}>{form.mark_lost ? "Mark lost" : "Confirm return"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

