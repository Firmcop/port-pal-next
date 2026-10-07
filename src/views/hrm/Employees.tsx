import { useState, useMemo } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Users, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmployeeDialog } from "@/components/hrm/EmployeeDialog";
import { format } from "date-fns";

const statusColor: Record<string, string> = {
  active: "bg-success/15 text-success",
  on_leave: "bg-warning/15 text-warning",
  terminated: "bg-muted text-muted-foreground",
};

function payStatus(pending: number, draftCount: number) {
  if (pending > 0) return { label: "Owed", className: "bg-warning/15 text-warning" };
  if (pending < 0) return { label: "Advance", className: "bg-info/15 text-info" };
  if (draftCount > 0) return { label: "Has draft", className: "bg-muted text-muted-foreground" };
  return { label: "Settled", className: "bg-success/15 text-success" };
}

export default function HRMEmployees() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [payFilter, setPayFilter] = useState<string>("all");

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["hrm-employees"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("employees")
        .select("*, control_account:financial_accounts(id,name)")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: accountBalances = [] } = useQuery({
    queryKey: ["hrm-fa-balances"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("financial_account_balances").select("account_id,current_balance");
      if (error) return [];
      return data ?? [];
    },
  });
  const balanceMap = useMemo(
    () => Object.fromEntries(accountBalances.map((b: any) => [b.account_id, Number(b.current_balance) || 0])),
    [accountBalances]
  );

  const { data: payroll = [] } = useQuery({
    queryKey: ["hrm-employee-payroll-status"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("employee_payroll_status").select("*");
      if (error) return [];
      return data ?? [];
    },
  });

  const payMap = useMemo(
    () => Object.fromEntries(payroll.map((p: any) => [p.employee_id, p])),
    [payroll]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e: any) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      const ps = payMap[e.id];
      const pending = Number(ps?.pending_amount ?? 0);
      const draft = Number(ps?.draft_count ?? 0);
      if (payFilter === "settled" && (pending !== 0 || draft > 0)) return false;
      if (payFilter === "owed" && !(pending > 0)) return false;
      if (payFilter === "draft" && !(draft > 0)) return false;
      if (!q) return true;
      return [e.name, e.code, e.email, e.division].some((v) => v?.toLowerCase().includes(q));
    });
  }, [employees, search, statusFilter, payFilter, payMap]);

  const saved = () => {
    qc.invalidateQueries({ queryKey: ["hrm-employees"] });
    setOpen(false);
    setEditing(null);
    toast({ title: editing ? "Employee updated" : "Employee created" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6" />Employees</h1>
          <p className="text-muted-foreground">Manage information for all employees within your business.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="mr-1 h-4 w-4" />New Employee</Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search by name, code, email, division" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="on_leave">On leave</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
              </SelectContent>
            </Select>
            <Select value={payFilter} onValueChange={setPayFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All pay status</SelectItem>
                <SelectItem value="settled">Settled</SelectItem>
                <SelectItem value="owed">Owed</SelectItem>
                <SelectItem value="draft">Has draft</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Control account</TableHead>
                <TableHead className="text-right">Account balance</TableHead>
                <TableHead className="text-right">Pending pay</TableHead>
                <TableHead>Last paid</TableHead>
                <TableHead>Pay status</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No employees match.</TableCell></TableRow>
              ) : filtered.map((e: any) => {
                const ps = payMap[e.id] ?? {};
                const pending = Number(ps.pending_amount ?? 0);
                const draftCount = Number(ps.draft_count ?? 0);
                const acctBal = e.control_account_id ? balanceMap[e.control_account_id] ?? 0 : null;
                const ind = payStatus(pending, draftCount);
                return (
                  <TableRow key={e.id} className="cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/hrm/employees/${e.id}`)}>
                    <TableCell className="font-mono text-xs">{e.code ?? "—"}</TableCell>
                    <TableCell className="font-medium">{e.name}</TableCell>
                    <TableCell className="text-sm">{e.email ?? "—"}</TableCell>
                    <TableCell className="text-sm">{e.control_account?.name ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{acctBal !== null ? acctBal.toFixed(2) : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{pending.toFixed(2)}</TableCell>
                    <TableCell className="text-xs">{ps.last_paid_at ? format(new Date(ps.last_paid_at), "dd MMM yyyy") : "—"}</TableCell>
                    <TableCell><Badge className={ind.className} variant="secondary">{ind.label}</Badge></TableCell>
                    <TableCell><Badge className={statusColor[e.status] ?? ""} variant="secondary">{e.status?.replace("_"," ") ?? "active"}</Badge></TableCell>
                    <TableCell onClick={(ev) => ev.stopPropagation()}>
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(e); setOpen(true); }}>Edit</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <EmployeeDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }} employee={editing} onSaved={saved} />
    </div>
  );
}
