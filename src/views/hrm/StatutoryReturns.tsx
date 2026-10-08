import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileDown, Landmark } from "lucide-react";
import { exportCSV } from "@/lib/export-utils";
import { fmtMoney } from "@/lib/finance-format";

type ReturnRow = {
  employee_id: string; employee_name: string; kra_pin: string | null; payslip_reference: string;
  gross_pay: number; nssf_employee: number; nssf_employer: number; shif: number;
  ahl_employee: number; ahl_employer: number; taxable_pay: number; paye: number; net_pay: number;
};
type P9Row = {
  month: string; gross_pay: number; nssf: number; shif: number; ahl: number; taxable_pay: number;
  tax_charged: number; personal_relief: number; paye: number;
};

const n = (v: unknown) => Number(v ?? 0);
const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Monthly statutory return (P10-style: PAYE, NSSF, SHIF, Housing Levy) and P9 tax cards, from posted payslips. */
export default function StatutoryReturns() {
  const [month, setMonth] = useState(thisMonth());
  const [employeeId, setEmployeeId] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["statutory-return", month],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("payroll_statutory_return", { _month: `${month}-01` });
      if (error) throw error;
      return (data ?? []) as ReturnRow[];
    },
  });

  const totals = useMemo(() => rows.reduce((t, r) => ({
    gross: t.gross + n(r.gross_pay), paye: t.paye + n(r.paye), nssf: t.nssf + n(r.nssf_employee) + n(r.nssf_employer),
    shif: t.shif + n(r.shif), ahl: t.ahl + n(r.ahl_employee) + n(r.ahl_employer),
  }), { gross: 0, paye: 0, nssf: 0, shif: 0, ahl: 0 }), [rows]);

  const { data: employees = [] } = useQuery({
    queryKey: ["statutory-employees"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("employees").select("id, name, tax_id").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: p9 = [] } = useQuery({
    queryKey: ["p9", employeeId, year],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("p9_card", { _year: Number(year), _employee_id: employeeId });
      if (error) throw error;
      return (data ?? []) as P9Row[];
    },
  });

  const exportReturn = () => exportCSV(`statutory-return-${month}.csv`,
    ["Employee", "KRA PIN", "Payslip", "Gross pay", "NSSF employee", "NSSF employer", "SHIF", "Housing Levy employee",
     "Housing Levy employer", "Taxable pay", "PAYE", "Net pay"],
    rows.map((r) => [r.employee_name, r.kra_pin ?? "", r.payslip_reference, String(r.gross_pay), String(r.nssf_employee),
      String(r.nssf_employer), String(r.shif), String(r.ahl_employee), String(r.ahl_employer), String(r.taxable_pay),
      String(r.paye), String(r.net_pay)]));

  const emp = employees.find((e: any) => e.id === employeeId);
  const exportP9 = () => exportCSV(`P9-${year}-${emp?.name ?? "employee"}.csv`,
    ["Month", "Gross pay", "NSSF", "SHIF", "Housing Levy", "Taxable pay", "Tax charged", "Personal relief", "PAYE"],
    p9.map((r) => [r.month.slice(0, 7), String(r.gross_pay), String(r.nssf), String(r.shif), String(r.ahl),
      String(r.taxable_pay), String(r.tax_charged), String(r.personal_relief), String(r.paye)]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Landmark className="h-6 w-6" />Statutory Returns</h1>
        <p className="text-muted-foreground">What to remit to KRA (PAYE), NSSF, SHA (SHIF) and the Housing Levy, from posted payslips.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
          <CardTitle className="text-base">Monthly return</CardTitle>
          <div className="flex items-end gap-2">
            <div><Label className="text-xs">Month</Label><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
            <Button variant="outline" size="sm" disabled={!rows.length} onClick={exportReturn}><FileDown className="h-4 w-4 mr-1" />CSV</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-md border p-3"><div className="text-muted-foreground">PAYE to KRA</div><div className="font-mono text-lg">{fmtMoney(totals.paye)}</div></div>
            <div className="rounded-md border p-3"><div className="text-muted-foreground">NSSF (both shares)</div><div className="font-mono text-lg">{fmtMoney(totals.nssf)}</div></div>
            <div className="rounded-md border p-3"><div className="text-muted-foreground">SHIF to SHA</div><div className="font-mono text-lg">{fmtMoney(totals.shif)}</div></div>
            <div className="rounded-md border p-3"><div className="text-muted-foreground">Housing Levy (both shares)</div><div className="font-mono text-lg">{fmtMoney(totals.ahl)}</div></div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead><TableHead>KRA PIN</TableHead>
                  <TableHead className="text-right">Gross</TableHead><TableHead className="text-right">NSSF (ee/er)</TableHead>
                  <TableHead className="text-right">SHIF</TableHead><TableHead className="text-right">Housing Levy (ee/er)</TableHead>
                  <TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">PAYE</TableHead>
                  <TableHead className="text-right">Net pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : !rows.length ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">No posted payslips for this month.</TableCell></TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.payslip_reference}>
                    <TableCell>{r.employee_name}</TableCell>
                    <TableCell className="font-mono text-xs">{r.kra_pin || <span className="text-destructive">missing</span>}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(r.gross_pay)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(r.nssf_employee)} / {fmtMoney(r.nssf_employer)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(r.shif)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(r.ahl_employee)} / {fmtMoney(r.ahl_employer)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(r.taxable_pay)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(r.paye)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(r.net_pay)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {rows.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2}>Total ({rows.length})</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(totals.gross)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(totals.nssf)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(totals.shif)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(totals.ahl)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono">{fmtMoney(totals.paye)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
          <CardTitle className="text-base">P9 tax deduction card</CardTitle>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px]">
              <Label className="text-xs">Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-24"><Label className="text-xs">Year</Label><Input type="number" value={year} onChange={(e) => setYear(e.target.value)} /></div>
            <Button variant="outline" size="sm" disabled={!p9.length} onClick={exportP9}><FileDown className="h-4 w-4 mr-1" />CSV</Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {emp && <p className="text-sm text-muted-foreground mb-2">{emp.name} · KRA PIN {emp.tax_id || "missing"}</p>}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">NSSF</TableHead>
                <TableHead className="text-right">SHIF</TableHead><TableHead className="text-right">Housing Levy</TableHead>
                <TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">Tax charged</TableHead>
                <TableHead className="text-right">Relief</TableHead><TableHead className="text-right">PAYE</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!employeeId ? (
                <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">Choose an employee.</TableCell></TableRow>
              ) : !p9.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">No posted payslips in {year}.</TableCell></TableRow>
              ) : p9.map((r) => (
                <TableRow key={r.month}>
                  <TableCell>{r.month.slice(0, 7)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.gross_pay)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.nssf)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.shif)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.ahl)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.taxable_pay)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.tax_charged)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.personal_relief)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.paye)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
