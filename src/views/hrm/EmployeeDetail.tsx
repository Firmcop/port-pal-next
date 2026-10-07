import { useNavigate, useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft } from "lucide-react";

const statusColor: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  posted: "bg-info/15 text-info",
  paid: "bg-success/15 text-success",
  void: "bg-destructive/15 text-destructive",
};

export default function HRMEmployeeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: emp } = useQuery({
    queryKey: ["hrm-employee", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("employees")
        .select("*, control_account:financial_accounts(id,name)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: payslips = [] } = useQuery({
    queryKey: ["hrm-employee-payslips", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payslips")
        .select("*")
        .eq("employee_id", id)
        .order("pay_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!emp) return <div className="p-6 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/hrm/employees")}><ArrowLeft className="mr-1 h-4 w-4" />Back to Employees</Button>

      <Card>
        <CardHeader><CardTitle>{emp.name}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><div className="text-xs text-muted-foreground">Code</div><div className="font-mono">{emp.code ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Email</div><div>{emp.email ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Phone</div><div>{emp.phone ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Role</div><div>{emp.role}</div></div>
          <div><div className="text-xs text-muted-foreground">Division</div><div>{emp.division ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Control account</div><div>{emp.control_account?.name ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Daily rate</div><div className="font-mono">{Number(emp.daily_rate ?? 0).toFixed(2)}</div></div>
          <div><div className="text-xs text-muted-foreground">Status</div><div>{emp.status}</div></div>
          <div><div className="text-xs text-muted-foreground">Hired on</div><div>{emp.hired_on ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Tax ID</div><div>{emp.tax_id ?? "—"}</div></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payslips</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payslips.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No payslips yet.</TableCell></TableRow>
              ) : payslips.map((p: any) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/hrm/payslips/${p.id}`)}>
                  <TableCell>{p.pay_date}</TableCell>
                  <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                  <TableCell className="text-xs">{p.period_start} → {p.period_end}</TableCell>
                  <TableCell className="text-right font-mono">{Number(p.gross_pay).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono">{Number(p.total_deductions).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{Number(p.net_pay).toFixed(2)}</TableCell>
                  <TableCell><Badge className={statusColor[p.status] ?? ""} variant="secondary">{p.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
