import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PackageOpen, Search, ChevronDown, ChevronRight } from "lucide-react";
import { fmtMoney } from "@/lib/finance-format";
import { ChargebackPanel } from "@/components/assets/ChargebackPanel";

export default function AssetIssues() {
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [chargebackFilter, setChargebackFilter] = useState<string>("any");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: rows, refetch } = useQuery({
    queryKey: ["asset-issues-all", statusFilter, chargebackFilter],
    queryFn: async () => {
      let query = supabase.from("asset_issues" as any)
        .select("*, asset:asset_id(id,code,name), emp:issued_to_employee_id(name), cust:issued_to_customer_id(name)")
        .order("issued_at", { ascending: false });
      if (statusFilter === "overdue") {
        query = query.eq("status", "open").lt("expected_return_at", new Date().toISOString());
      } else if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      if (chargebackFilter !== "any") {
        query = query.eq("chargeback_status", chargebackFilter);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows ?? [];
    return (rows ?? []).filter((r) =>
      [r.asset?.code, r.asset?.name, r.emp?.name, r.cust?.name, r.issued_to_name, r.purpose]
        .filter(Boolean).some((v: string) => v.toLowerCase().includes(s))
    );
  }, [rows, q]);

  const pendingCount = (rows ?? []).filter((r) => r.chargeback_status === "pending_approval").length;
  const outstandingBalance = (rows ?? [])
    .filter((r) => ["approved","invoiced","partially_paid"].includes(r.chargeback_status))
    .reduce((s, r) => s + Math.max(0, Number(r.damage_charge_amount || 0) - Number(r.chargeback_amount_paid || 0)), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><PackageOpen className="h-6 w-6" />Issues & Returns</h1>
        <p className="text-muted-foreground">Short-term tool checkout: track who has what, condition on both legs, and damage/loss chargebacks.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Open issues</div>
          <div className="text-2xl font-bold">{(rows ?? []).filter((r) => r.status === "open").length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Chargebacks pending approval</div>
          <div className="text-2xl font-bold text-amber-600">{pendingCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Outstanding chargeback balance</div>
          <div className="text-2xl font-bold text-destructive font-mono">{fmtMoney(outstandingBalance)}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search asset, holder, purpose…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="returned">Returned</SelectItem>
                  <SelectItem value="damaged">Damaged</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Chargeback</Label>
              <Select value={chargebackFilter} onValueChange={setChargebackFilter}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="pending_approval">Pending approval</SelectItem>
                  <SelectItem value="approved">Approved · unpaid</SelectItem>
                  <SelectItem value="partially_paid">Partially paid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="waived">Waived</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Holder</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Expected back</TableHead>
                <TableHead>Returned</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-right">Charge</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Chargeback</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!filtered.length ? (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No records.</TableCell></TableRow>
              ) : filtered.map((r: any) => {
                const overdue = r.status === "open" && r.expected_return_at && new Date(r.expected_return_at) < new Date();
                const cb = r.chargeback_status ?? "none";
                const hasCb = cb !== "none";
                const isOpen = !!expanded[r.id];
                return (
                  <>
                    <TableRow key={r.id} className={hasCb ? "cursor-pointer" : ""} onClick={hasCb ? () => setExpanded((s) => ({ ...s, [r.id]: !s[r.id] })) : undefined}>
                      <TableCell>{hasCb ? (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}</TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link to={`/assets/${r.asset?.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{r.asset?.code}</Link>
                        <div className="text-muted-foreground">{r.asset?.name}</div>
                      </TableCell>
                      <TableCell className="text-xs">{r.emp?.name || r.cust?.name || r.issued_to_name || "—"}</TableCell>
                      <TableCell className="text-xs">{new Date(r.issued_at).toLocaleDateString()}</TableCell>
                      <TableCell className={`text-xs ${overdue ? "text-destructive font-semibold" : ""}`}>
                        {r.expected_return_at ? new Date(r.expected_return_at).toLocaleDateString() : "—"}
                        {overdue && " (overdue)"}
                      </TableCell>
                      <TableCell className="text-xs">{r.returned_at ? new Date(r.returned_at).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-xs">{r.condition_out} → {r.condition_in || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.damage_charge_amount ? fmtMoney(r.damage_charge_amount) : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.chargeback_amount_paid ? fmtMoney(r.chargeback_amount_paid) : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "open" ? "default" : r.status === "returned" ? "secondary" : "destructive"}>{r.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {hasCb ? <Badge variant="outline" className="text-xs">{cb.replace(/_/g, " ")}</Badge> : "—"}
                      </TableCell>
                    </TableRow>
                    {hasCb && isOpen && (
                      <TableRow key={r.id + "-cb"}>
                        <TableCell colSpan={11} className="bg-muted/20 p-4">
                          <ChargebackPanel issue={r} onChanged={() => refetch()} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
