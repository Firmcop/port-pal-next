import { useParams, Link } from "@/lib/router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, FolderKanban, Pencil } from "lucide-react";
import { format } from "date-fns";
import { EditConversionRevenueDialog } from "@/components/conversions/EditConversionRevenueDialog";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";

export default function ProjectDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { isOwnerOrAdmin } = useUserStaffRole();
  const [revenueJob, setRevenueJob] = useState<any | null>(null);

  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("projects").select("*, customer:customers(company_name)").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: pnl } = useQuery({
    queryKey: ["project-pnl", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("project_pnl").select("*").eq("project_id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: jobCosts } = useQuery({
    queryKey: ["project-job-costs", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("project_job_costs").select("*").eq("project_id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: txns } = useQuery({
    queryKey: ["project-txns", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounting_transactions").select("*").eq("project_id", id!).order("transaction_date", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });


  const { data: invoices } = useQuery({
    queryKey: ["project-invoices", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("invoices").select("id, invoice_number, total_amount, status, issued_at").eq("project_id", id).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: saLots } = useQuery({
    queryKey: ["project-sa-lots", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sub_assembly_lots")
        .select("id, qty, unit_cost, created_at, assembly:assembly_stock_id(name, uom)")
        .eq("project_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id,
  });

  const { data: convJobs } = useQuery({
    queryKey: ["project-conversions", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("container_conversions")
        .select("id, conversion_number, status, qty_produced, quoted_price, currency, created_at, customers:customer_id(company_name)")
        .eq("project_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });


  if (!project) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const jobCost = Number(jobCosts?.job_cost_total || 0);
  const cost = Number(pnl?.cogs || 0) + Number(pnl?.expenses || 0) + jobCost;
  const revenue = Number(pnl?.revenue || 0);
  const margin = revenue - cost;
  const burn = project.budget_amount > 0 ? (cost / Number(project.budget_amount)) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild><Link to="/finance/projects"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FolderKanban className="h-6 w-6" />{project.name}</h1>
          <p className="text-sm text-muted-foreground">{project.code} · <Badge variant="secondary">{project.status.replace("_"," ")}</Badge> · {project.customer?.company_name ?? "No customer"}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Budget</p><p className="text-xl font-mono">{Number(project.budget_amount).toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Revenue</p><p className="text-xl font-mono text-success">{revenue.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Cost</p><p className="text-xl font-mono text-destructive">{cost.toFixed(2)}</p><p className="text-[10px] text-muted-foreground">incl. job costs {jobCost.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Margin</p><p className={`text-xl font-mono font-bold ${margin >= 0 ? "text-success" : "text-destructive"}`}>{margin.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Budget Burn</p><p className={`text-xl font-mono font-bold ${burn > 100 ? "text-destructive" : ""}`}>{burn.toFixed(1)}%</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Job costs from linked conversion jobs</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Materials</p><p className="font-mono">{Number(jobCosts?.material_cost || 0).toFixed(2)}</p></div>
          <div><p className="text-xs text-muted-foreground">Labour</p><p className="font-mono">{Number(jobCosts?.labour_cost || 0).toFixed(2)}</p></div>
          <div><p className="text-xs text-muted-foreground">Services</p><p className="font-mono">{Number(jobCosts?.service_cost || 0).toFixed(2)}</p></div>
          <div><p className="text-xs text-muted-foreground">Containers</p><p className="font-mono">{Number(jobCosts?.container_cost || 0).toFixed(2)}</p></div>
          <div><p className="text-xs text-muted-foreground">Total</p><p className="font-mono font-bold">{jobCost.toFixed(2)}</p></div>
        </CardContent>
      </Card>


      <Tabs defaultValue="transactions">
        <TabsList>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="conversions">Conversion Jobs</TabsTrigger>
          <TabsTrigger value="subassemblies">Sub-assembly Builds</TabsTrigger>

        </TabsList>
        <TabsContent value="transactions" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Txn #</TableHead>
                    <TableHead>Account Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!txns?.length ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No transactions yet for this project.</TableCell></TableRow>
                  ) : txns.map((t: any) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-xs">{format(new Date(t.transaction_date), "yyyy-MM-dd")}</TableCell>
                      <TableCell className="font-mono text-xs">{t.transaction_number}</TableCell>
                      <TableCell className="text-xs">{t.account_type?.replace("_"," ")}</TableCell>
                      <TableCell>{t.description}</TableCell>
                      <TableCell className="text-right font-mono">{Number(t.debit_amount) > 0 ? Number(t.debit_amount).toFixed(2) : ""}</TableCell>
                      <TableCell className="text-right font-mono">{Number(t.credit_amount) > 0 ? Number(t.credit_amount).toFixed(2) : ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="invoices" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>#</TableHead><TableHead>Issued</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {!invoices?.length ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No invoices linked.</TableCell></TableRow>
                  ) : invoices.map((i: any) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono text-xs">{i.invoice_number}</TableCell>
                      <TableCell className="text-xs">{i.issued_at ? format(new Date(i.issued_at), "yyyy-MM-dd") : "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{i.status}</Badge></TableCell>
                      <TableCell className="text-right font-mono">{Number(i.total_amount).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="conversions" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job No</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Quoted</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!convJobs?.length ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No conversion jobs linked to this project.</TableCell></TableRow>
                  ) : convJobs.map((c: any) => (
                    <TableRow key={c.id} className="cursor-pointer hover:bg-muted/40" onClick={() => (window.location.href = `/conversions/${c.id}`)}>
                      <TableCell className="font-mono text-xs">{c.conversion_number}</TableCell>
                      <TableCell>{c.customers?.company_name ?? "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{c.status?.replace("_", " ")}</Badge></TableCell>
                      <TableCell className="text-right font-mono">{c.qty_produced ?? 0}</TableCell>
                      <TableCell className="text-right font-mono">{Number(c.quoted_price || 0).toFixed(2)} {c.currency ?? ""}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(c.created_at), "yyyy-MM-dd")}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()} className="text-right">
                        {isOwnerOrAdmin && c.status !== "cancelled" && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setRevenueJob(c)}>
                            <Pencil className="h-3 w-3 mr-1" />Revenue
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subassemblies" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Built</TableHead>
                    <TableHead>Sub-assembly</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!saLots?.length ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No sub-assembly builds linked to this project.</TableCell></TableRow>
                  ) : saLots.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">{format(new Date(l.created_at), "yyyy-MM-dd")}</TableCell>
                      <TableCell>{l.assembly?.name ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{Number(l.qty).toFixed(2)} {l.assembly?.uom ?? ""}</TableCell>
                      <TableCell className="text-right font-mono">{Number(l.unit_cost || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">{(Number(l.qty || 0) * Number(l.unit_cost || 0)).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>


      {revenueJob && (
        <EditConversionRevenueDialog
          open={!!revenueJob}
          onOpenChange={(o) => { if (!o) setRevenueJob(null); }}
          job={revenueJob}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["project-conversions", id] });
            qc.invalidateQueries({ queryKey: ["project-pnl", id] });
            qc.invalidateQueries({ queryKey: ["project-job-costs", id] });
            qc.invalidateQueries({ queryKey: ["project-txns", id] });
          }}
        />
      )}
    </div>
  );
}
