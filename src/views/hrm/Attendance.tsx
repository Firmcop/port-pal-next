import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, History, Loader2, Lock, Plus, Trash2, Users, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/app-settings";
import { useOrgCurrency } from "@/hooks/use-org-currency";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import { usePermission } from "@/hooks/use-permissions";

const NONE = "none";

function mondayOf(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Mon = 0
  x.setDate(x.getDate() - day);
  return x.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const statusColor: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-info/15 text-info",
  paid: "bg-success/15 text-success",
};

export default function Attendance() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currency } = useOrgCurrency();
  const approvePerm = usePermission("hrm", "approve");
  const attendancePerm = usePermission("hrm_attendance", "view");
  // Attendance-only users get a strict data-entry surface, never payroll details.
  const restricted = attendancePerm.data === true && approvePerm.data !== true;
  const permissionsReady = !attendancePerm.isLoading && !approvePerm.isLoading;
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(new Date()));
  const [lineOpen, setLineOpen] = useState(false);
  const [timesheetOpen, setTimesheetOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [correcting, setCorrecting] = useState<any>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payAccount, setPayAccount] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [view, setView] = useState<"lines" | "projects">("lines");
  const { data: accounts = [] } = useFinancialAccounts();

  const weekEnd = addDays(weekStart, 6);

  const { data: week, isLoading } = useQuery({
    queryKey: ["attendance-week", weekStart],
    enabled: permissionsReady,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("attendance_weeks")
        .select("*")
        .eq("week_start", weekStart)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ["attendance-lines", week?.id, restricted],
    enabled: permissionsReady && !!week?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("attendance_lines")
        .select(restricted
          ? "id,employee_id,project_id,conversion_id,days,hours,basis,work_date,employee:employee_id(name,code,pay_basis),project:project_id(name),conversion:conversion_id(conversion_number)"
          : "*, employee:employee_id(name, code, pay_basis), project:project_id(name), conversion:conversion_id(conversion_number)")
        .eq("week_id", week.id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: audit = [] } = useQuery({
    queryKey: ["attendance-audit", week?.id],
    enabled: permissionsReady && !restricted && !!week?.id && historyOpen,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("attendance_audit")
        .select("*")
        .eq("week_id", week.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["attendance-weekly-employees", restricted],
    enabled: permissionsReady,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("employees")
        .select(restricted
          ? "id,name,code,pay_basis,pay_frequency"
          : "id,name,code,pay_basis,pay_frequency,daily_rate,hourly_rate,deductions")
        .eq("status", "active")
        .eq("pay_frequency", "weekly")
        .order("name");
      return data ?? [];
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["attendance-projects"],
    enabled: permissionsReady,
    queryFn: async () => {
      const { data } = await (supabase as any).from("projects").select("id,name").eq("status", "active").order("name");
      return data ?? [];
    },
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ["attendance-jobs"],
    enabled: permissionsReady,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("container_conversions")
        .select("id,conversion_number,status")
        .in("status", ["planning", "in_progress"])
        .order("conversion_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: holidays = [] } = useQuery({
    queryKey: ["public-holidays"],
    enabled: permissionsReady,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("public_holidays")
        .select("id,holiday_date,name")
        .order("holiday_date", { ascending: false });
      return data ?? [];
    },
  });
  const holidaySet = useMemo(
    () => new Set((holidays as any[]).map((h) => h.holiday_date)),
    [holidays]
  );


  const editable = !week || week.status === "draft";
  const gross = useMemo(() => lines.reduce((s: number, l: any) => s + Number(l.amount || 0), 0), [lines]);
  const deductionTotal = Number(week?.deduction_amount ?? 0);
  const net = Number(week?.net_amount ?? gross - deductionTotal);

  const grouped = useMemo(() => {
    const map = new Map<string, any>();
    for (const l of lines as any[]) {
      const key = l.employee_id ?? l.id;
      if (!map.has(key)) {
        map.set(key, { key, name: l.employee?.name ?? "—", rows: [], days: 0, hours: 0, ot: 0, amount: 0 });
      }
      const g = map.get(key);
      g.rows.push(l);
      g.days += Number(l.days || 0);
      g.hours += Number(l.hours || 0);
      g.ot += Number(l.overtime_hours || 0);
      g.amount += Number(l.amount || 0);
    }
    return Array.from(map.values());
  }, [lines]);

  // Per-project view: project → job → employee totals for the week.
  const byProject = useMemo(() => {
    const projects = new Map<string, any>();
    for (const l of lines as any[]) {
      const pKey = l.project_id ?? "none";
      if (!projects.has(pKey)) {
        projects.set(pKey, {
          key: pKey,
          name: l.project?.name ?? "Unassigned",
          jobs: new Map<string, any>(),
          days: 0, hours: 0, ot: 0, amount: 0,
        });
      }
      const p = projects.get(pKey);
      const jKey = l.conversion_id ?? "none";
      if (!p.jobs.has(jKey)) {
        p.jobs.set(jKey, { key: jKey, name: l.conversion?.conversion_number ?? "No job", employees: new Map<string, any>() });
      }
      const j = p.jobs.get(jKey);
      const eKey = l.employee_id ?? l.id;
      if (!j.employees.has(eKey)) {
        j.employees.set(eKey, { key: eKey, name: l.employee?.name ?? "—", code: l.employee?.code ?? "", days: 0, hours: 0, ot: 0, amount: 0 });
      }
      const e = j.employees.get(eKey);
      const d = Number(l.days || 0), h = Number(l.hours || 0), o = Number(l.overtime_hours || 0), a = Number(l.amount || 0);
      e.days += d; e.hours += h; e.ot += o; e.amount += a;
      p.days += d; p.hours += h; p.ot += o; p.amount += a;
    }
    return Array.from(projects.values()).map((p: any) => ({
      ...p,
      jobs: Array.from(p.jobs.values()).map((j: any) => ({ ...j, employees: Array.from(j.employees.values()) })),
    }));
  }, [lines]);

  const exportProjectCsv = () => {
    const head = ["Project", "Job", "Employee", "Code", "Days", "Hours", "Overtime hrs"].concat(restricted ? [] : ["Amount"]);
    const rows: string[][] = [];
    for (const p of byProject) {
      for (const j of p.jobs) {
        for (const e of j.employees) {
          rows.push([p.name, j.name, e.name, e.code, String(e.days), String(e.hours), String(e.ot)].concat(restricted ? [] : [e.amount.toFixed(2)]));
        }
      }
    }
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-by-project-${weekStart}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };



  const ensureWeek = async () => {
    if (week?.id) return week.id as string;
    const { data, error } = await (supabase as any).rpc("ensure_attendance_week", { _week_start: weekStart });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["attendance-week", weekStart] });
    return data as string;
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["attendance-week", weekStart] });
    qc.invalidateQueries({ queryKey: ["attendance-lines"] });
    qc.invalidateQueries({ queryKey: ["attendance-audit"] });
  };

  const saveLine = useMutation({
    mutationFn: async (form: any) => {
      const weekId = await ensureWeek();
      const { error } = await (supabase as any).rpc("upsert_attendance_line", {
        _week_id: weekId,
        _employee_id: form.employee_id,
        _days: Number(form.days) || 0,
        _hours: Number(form.hours) || 0,
        _overtime_hours: Number(form.overtime_hours) || 0,
        _project_id: form.project_id || null,
        _conversion_id: form.conversion_id || null,
        _notes: form.notes || null,
        _line_id: form.id || null,
        _allowance: Number(form.allowance) || 0,
        _allowance_label: form.allowance_label || null,
        _work_date: form.work_date || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { setLineOpen(false); setEditing(null); refresh(); },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const saveTimesheet = useMutation({
    mutationFn: async (payload: any) => {
      const weekId = await ensureWeek();
      const rows = payload.rows as any[];
      let saved = 0;
      for (const r of rows) {
        try {
          const { error } = await (supabase as any).rpc("upsert_attendance_line", {
            _week_id: weekId,
            _employee_id: payload.employee_id,
            _days: Number(r.days) || 0,
            _hours: Number(r.hours) || 0,
            _overtime_hours: Number(r.overtime_hours) || 0,
            _project_id: r.project_id || null,
            _conversion_id: r.conversion_id || null,
            _notes: [r.date, payload.notes].filter(Boolean).join(" — ") || null,
            _line_id: null,
            _allowance: saved === 0 ? Number(payload.allowance) || 0 : 0,
            _allowance_label: saved === 0 ? payload.allowance_label || null : null,
            _work_date: r.date,
          });
          if (error) throw error;
          saved += 1;
        } catch (e: any) {
          throw new Error(`${r.date}: ${e.message}`);
        }
      }
      return saved;
    },
    onSuccess: (n: number) => {
      setTimesheetOpen(false);
      toast({ title: "Timesheet saved", description: `${n} day${n === 1 ? "" : "s"} recorded.` });
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not save timesheet", description: e.message, variant: "destructive" }),
  });

  const saveBulk = useMutation({
    mutationFn: async (payload: any) => {
      const weekId = await ensureWeek();
      const entries = payload.entries as any[];
      let saved = 0;
      for (const entry of entries) {
        try {
          const { error } = await (supabase as any).rpc("upsert_attendance_line", {
            _week_id: weekId,
            _employee_id: entry.employee_id,
            _days: Number(entry.days) || 0,
            _hours: Number(entry.hours) || 0,
            _overtime_hours: Number(entry.overtime_hours) || 0,
            _project_id: entry.project_id || null,
            _conversion_id: entry.conversion_id || null,
            _notes: entry.date,
            _line_id: null,
            _allowance: 0,
            _allowance_label: null,
            _work_date: entry.date,
          });
          if (error) throw error;
          saved += 1;
        } catch (e: any) {
          throw new Error(`${entry.employee_name} (${entry.date}): ${e.message}`);
        }
      }
      return saved;
    },
    onSuccess: (n: number) => {
      setBulkOpen(false);
      toast({ title: "Bulk entry saved", description: `${n} entr${n === 1 ? "y" : "ies"} recorded.` });
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not save bulk entry", description: e.message, variant: "destructive" }),
  });



  const correctLine = useMutation({
    mutationFn: async (form: any) => {
      const { error } = await (supabase as any).rpc("correct_attendance_line", {
        _line_id: form.id,
        _days: Number(form.days) || 0,
        _hours: Number(form.hours) || 0,
        _overtime_hours: Number(form.overtime_hours) || 0,
        _allowance: Number(form.allowance) || 0,
        _allowance_label: form.allowance_label || null,
        _project_id: form.project_id || null,
        _conversion_id: form.conversion_id || null,
        _reason: form.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCorrecting(null);
      toast({ title: "Correction recorded", description: "The original entry was reversed and an adjusting journal posted." });
      refresh();
    },
    onError: (e: any) => toast({ title: "Correction failed", description: e.message, variant: "destructive" }),
  });

  const removeLine = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("delete_attendance_line", { _line_id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: any) => toast({ title: "Could not delete", description: e.message, variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("approve_attendance_week", { _week_id: week.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Week approved", description: "Wages, allowances and deductions posted to jobs, projects and the ledger." });
      refresh();
    },
    onError: (e: any) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  // amount still owed on a paid week (e.g. a correction added wages after payment)
  const { data: balanceDue = 0 } = useQuery({
    queryKey: ["attendance-balance-due", week?.id, week?.status],
    enabled: !!week?.id && week?.status === "paid",
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("attendance_week_balance_due", { _week_id: week!.id });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });

  const pay = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("pay_attendance_week", { _week_id: week.id, _from_account_id: payAccount });
      if (error) throw error;
    },
    onSuccess: () => {
      setPayOpen(false);
      toast({ title: week?.status === "paid" ? "Balance paid" : "Net wages paid" });
      qc.invalidateQueries({ queryKey: ["attendance-balance-due"] });
      refresh();
    },
    onError: (e: any) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays className="h-6 w-6" />Weekly Attendance</h1>
          {!restricted && <p className="text-muted-foreground">Record days or hours, overtime and allowances, assign work to jobs or projects, then approve and pay the week.</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button>
          <Input type="date" className="w-[160px]" value={weekStart} onChange={(e) => e.target.value && setWeekStart(mondayOf(new Date(e.target.value)))} />
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            Week {weekStart} → {weekEnd}
            <Badge className={statusColor[week?.status ?? "draft"]} variant="secondary">{week?.status ?? "draft"}</Badge>
            {!editable && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />locked — corrections only</span>}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-md border p-0.5">
              <Button size="sm" variant={view === "lines" ? "secondary" : "ghost"} className="h-7 px-3" onClick={() => setView("lines")}>Entries</Button>
              <Button size="sm" variant={view === "projects" ? "secondary" : "ghost"} className="h-7 px-3" onClick={() => setView("projects")}>By project</Button>
            </div>
            {!restricted && (
              <Button size="sm" variant="outline" onClick={() => setHolidayOpen(true)}><CalendarDays className="mr-1 h-4 w-4" />Holidays</Button>
            )}
            {editable && (
              <Button size="sm" onClick={() => setTimesheetOpen(true)}><CalendarDays className="mr-1 h-4 w-4" />Weekly timesheet</Button>
            )}
            {editable && (
              <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}><Users className="mr-1 h-4 w-4" />Bulk entry</Button>
            )}
            {editable && (
              <Button size="sm" variant="outline" onClick={() => { setEditing(null); setLineOpen(true); }}><Plus className="mr-1 h-4 w-4" />Add entry</Button>
            )}
            {!restricted && week?.id && (
              <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}><History className="mr-1 h-4 w-4" />History</Button>
            )}
            {!restricted && week?.status === "draft" && lines.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => approve.mutate()} disabled={approve.isPending}>
                {approve.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}Approve week
              </Button>
            )}
            {!restricted && week?.status === "approved" && (
              <Button size="sm" onClick={() => setPayOpen(true)}><Wallet className="mr-1 h-4 w-4" />Pay wages</Button>
            )}
            {!restricted && week?.status === "paid" && balanceDue > 0.004 && (
              <Button size="sm" onClick={() => setPayOpen(true)}><Wallet className="mr-1 h-4 w-4" />Pay balance {formatMoney(balanceDue, currency)}</Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {view === "projects" ? (
            <ProjectAttendanceView
              byProject={byProject}
              restricted={restricted}
              currency={currency}
              onExport={exportProjectCsv}
            />
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                {!restricted && <TableHead>Basis</TableHead>}
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                {!restricted && <TableHead className="text-right">OT hrs</TableHead>}
                <TableHead>Job / Project</TableHead>
                {!restricted && <TableHead className="text-right">Rate</TableHead>}
                {!restricted && <TableHead className="text-right">Base</TableHead>}
                {!restricted && <TableHead className="text-right">Overtime</TableHead>}
                {!restricted && <TableHead className="text-right">Allowance</TableHead>}
                {!restricted && <TableHead className="text-right">Amount</TableHead>}
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={restricted ? 5 : 12} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : lines.length === 0 ? (
                <TableRow><TableCell colSpan={restricted ? 5 : 12} className="text-center py-8 text-muted-foreground">No attendance recorded for this week yet.</TableCell></TableRow>
              ) : grouped.map((g: any) => (
                <Fragment key={g.key}>
                {g.rows.map((l: any) => (
                <TableRow key={l.id} className={l.reverses_line_id ? "opacity-70" : ""}>
                  <TableCell>
                    <div className="font-medium">{l.employee?.name ?? "—"}</div>
                   <div className="text-xs text-muted-foreground font-mono">
                     {l.employee?.code ?? ""}
                     {l.work_date ? <span className="ml-1">· {l.work_date}</span> : null}
                     {holidaySet.has(l.work_date) ? <span className="ml-1 text-info">holiday</span> : null}
                   </div>
                    {l.is_correction && (
                      <div className="text-[10px] text-muted-foreground italic">{l.reverses_line_id ? "Reversal" : "Correction"}{l.correction_reason ? ` — ${l.correction_reason}` : ""}</div>
                    )}
                  </TableCell>
                   {!restricted && <TableCell className="capitalize text-sm">{l.basis}</TableCell>}
                  <TableCell className="text-right font-mono">{Number(l.days || 0)}</TableCell>
                  <TableCell className="text-right font-mono">{Number(l.hours || 0)}</TableCell>
                   {!restricted && <TableCell className="text-right font-mono">{Number(l.overtime_hours || 0)}</TableCell>}
                  <TableCell className="text-sm">{l.conversion?.conversion_number ?? l.project?.name ?? <span className="text-muted-foreground">General</span>}</TableCell>
                  {!restricted && <TableCell className="text-right font-mono">{formatMoney(Number(l.rate || 0), currency)}</TableCell>}
                  {!restricted && <TableCell className="text-right font-mono">{formatMoney(Number(l.base_amount || 0), currency)}</TableCell>}
                  {!restricted && <TableCell className="text-right font-mono">{formatMoney(Number(l.overtime_amount || 0), currency)}</TableCell>}
                  {!restricted && (
                  <TableCell className="text-right font-mono">
                    {formatMoney(Number(l.allowance || 0), currency)}
                    {l.allowance_label ? <div className="text-[10px] text-muted-foreground">{l.allowance_label}</div> : null}
                  </TableCell>
                  )}
                  {!restricted && <TableCell className="text-right font-mono font-semibold">{formatMoney(Number(l.amount || 0), currency)}</TableCell>}
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {editable ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(l); setLineOpen(true); }}>Edit</Button>
                          {!restricted && <Button size="icon" variant="ghost" onClick={() => removeLine.mutate(l.id)}><Trash2 className="h-4 w-4" /></Button>}
                        </>
                      ) : !restricted && !l.reverses_line_id ? (
                        <Button size="sm" variant="ghost" onClick={() => setCorrecting(l)}>Correct</Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
                ))}
                {g.rows.length > 1 && (
                  <TableRow key={`${g.key}-sub`} className="bg-muted/40">
                    <TableCell colSpan={restricted ? 1 : 2} className="text-xs text-muted-foreground">{g.name} subtotal</TableCell>
                    <TableCell className="text-right font-mono text-xs">{g.days}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{g.hours}</TableCell>
                    {!restricted && <TableCell className="text-right font-mono text-xs">{g.ot}</TableCell>}
                    <TableCell colSpan={restricted ? 1 : 5} />
                    {!restricted && <TableCell className="text-right font-mono text-xs font-semibold">{formatMoney(g.amount, currency)}</TableCell>}
                    <TableCell />
                  </TableRow>
                )}
                </Fragment>
              ))}
              {!restricted && lines.length > 0 && (
                <>
                  <TableRow>
                    <TableCell colSpan={10} className="text-right font-medium">Gross</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatMoney(gross, currency)}</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={10} className="text-right text-muted-foreground">Deductions</TableCell>
                    <TableCell className="text-right font-mono">- {formatMoney(deductionTotal, currency)}</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={10} className="text-right font-semibold">Net payable</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatMoney(net, currency)}</TableCell>
                    <TableCell />
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      <BulkEntryDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        weekStart={weekStart}
        employees={employees}
        projects={projects}
        jobs={jobs}
        lines={lines}
        clerk={restricted}
        saving={saveBulk.isPending}
        onSave={(p: any) => saveBulk.mutate(p)}
      />

      <TimesheetDialog
        open={timesheetOpen}
        onOpenChange={setTimesheetOpen}
        weekStart={weekStart}
        employees={employees}
        projects={projects}
        jobs={jobs}
        lines={lines}
        clerk={restricted}
        saving={saveTimesheet.isPending}
        onSave={(p: any) => saveTimesheet.mutate(p)}
      />


      <LineDialog
        open={lineOpen}
        onOpenChange={(v: boolean) => { setLineOpen(v); if (!v) setEditing(null); }}
        line={editing}
        employees={employees}
        projects={projects}
        jobs={jobs}
        clerk={restricted}
        weekStart={weekStart}
        weekEnd={weekEnd}
        holidaySet={holidaySet}
        saving={saveLine.isPending}
        onSave={(f: any) => saveLine.mutate(f)}
      />

      <LineDialog
        open={!!correcting}
        onOpenChange={(v: boolean) => { if (!v) setCorrecting(null); }}
        line={correcting}
        employees={employees}
        projects={projects}
        jobs={jobs}
        correction
        saving={correctLine.isPending}
        onSave={(f: any) => correctLine.mutate(f)}
      />

      <HolidaysDialog
        open={holidayOpen}
        onOpenChange={setHolidayOpen}
        holidays={holidays}
        onChanged={() => qc.invalidateQueries({ queryKey: ["public-holidays"] })}
      />


      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Change history — week {weekStart}</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
            ) : audit.map((a: any) => (
              <div key={a.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{a.action}</span>
                  <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                </div>
                {a.reason && <div className="text-xs text-muted-foreground italic">{a.reason}</div>}
                {a.after?.amount !== undefined && (
                  <div className="text-xs font-mono">
                    {a.before?.amount !== undefined ? `${Number(a.before.amount).toFixed(2)} → ` : ""}
                    {Number(a.after.amount).toFixed(2)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Pay week {weekStart}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Gross</span><span className="font-mono">{formatMoney(Number(week?.gross_amount ?? gross), currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Deductions</span><span className="font-mono">- {formatMoney(deductionTotal, currency)}</span></div>
              <div className="flex justify-between pt-1 border-t"><span className="font-medium">Net payable</span><span className="text-xl font-bold">{formatMoney(net, currency)}</span></div>
              {week?.status === "paid" && (
                <div className="flex justify-between pt-1 border-t"><span className="font-medium">Balance still owed (corrections)</span><span className="text-xl font-bold">{formatMoney(balanceDue, currency)}</span></div>
              )}
            </div>
            <div className="space-y-1">
              <Label>Paying account</Label>
              <Select value={payAccount} onValueChange={setPayAccount}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{a.currency ? ` (${a.currency})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={() => pay.mutate()} disabled={!payAccount || pay.isPending}>
              {pay.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Confirm payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LineDialog({ open, onOpenChange, line, employees, projects, jobs, saving, onSave, correction, clerk, weekStart, weekEnd, holidaySet }: any) {
  const blank = { id: "", employee_id: "", work_date: weekStart ?? "", days: "0", hours: "0", overtime_hours: "0", allowance: "0", allowance_label: "", project_id: "", conversion_id: "", notes: "", reason: "" };
  const [form, setForm] = useState<any>(blank);
  const [seeded, setSeeded] = useState<string | null>(null);
  const key = (line?.id ?? "new") + String(open) + String(!!correction);
  if (open && seeded !== key) {
    setSeeded(key);
    setForm(line ? {
      id: line.id,
      employee_id: line.employee_id,
      work_date: line.work_date ?? weekStart ?? "",
      days: String(line.days ?? 0),
      hours: String(line.hours ?? 0),
      overtime_hours: String(line.overtime_hours ?? 0),
      allowance: String(line.allowance ?? 0),
      allowance_label: line.allowance_label ?? "",
      project_id: line.project_id ?? "",
      conversion_id: line.conversion_id ?? "",
      notes: line.notes ?? "",
      reason: "",
    } : blank);
  }
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const emp = employees.find((e: any) => e.id === form.employee_id);
  const hourly = emp?.pay_basis === "hourly";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{correction ? "Correct entry" : line ? "Edit entry" : "Add attendance entry"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Employee *</Label>
            <Select value={form.employee_id} onValueChange={(v) => set("employee_id", v)} disabled={!!correction}>
              <SelectTrigger><SelectValue placeholder="Select weekly-paid employee" /></SelectTrigger>
              <SelectContent>
                {employees.map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}{e.code ? ` · ${e.code}` : ""}{clerk ? "" : ` — ${e.pay_basis}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {employees.length === 0 && <p className="text-xs text-muted-foreground">No weekly-paid employees yet — set pay frequency to weekly on the employee record.</p>}
          </div>
          {!correction && (
            <div className="space-y-1">
              <Label>Day worked *</Label>
              <Input type="date" min={weekStart} max={weekEnd} value={form.work_date} onChange={(e) => set("work_date", e.target.value)} />
              {holidaySet?.has(form.work_date) && (
                <p className="text-xs text-info">Public holiday — this day is paid at the holiday rate.</p>
              )}
            </div>
          )}
          <div className={`grid gap-3 ${clerk ? "grid-cols-2" : "grid-cols-3"}`}>
            <div className="space-y-1">
              <Label>Days</Label>
              <Input type="number" step="0.5" min="0" disabled={hourly} value={form.days} onChange={(e) => set("days", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Hours</Label>
              <Input type="number" step="0.25" min="0" disabled={!hourly} value={form.hours} onChange={(e) => set("hours", e.target.value)} />
            </div>
            {!clerk && (
            <div className="space-y-1">
              <Label>Overtime hrs</Label>
              <Input type="number" step="0.25" min="0" value={form.overtime_hours} onChange={(e) => set("overtime_hours", e.target.value)} />
            </div>
            )}
          </div>
          {!clerk && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Allowance</Label>
              <Input type="number" step="0.01" min="0" value={form.allowance} onChange={(e) => set("allowance", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Allowance description</Label>
              <Input value={form.allowance_label} onChange={(e) => set("allowance_label", e.target.value)} placeholder="e.g. Transport, meals" />
            </div>
          </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Conversion job</Label>
              <Select value={form.conversion_id || NONE} onValueChange={(v) => set("conversion_id", v === NONE ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {jobs.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.conversion_number}</SelectItem>)}
                </SelectContent>
              </Select>
              {jobs.length === 0 && <p className="text-xs text-muted-foreground">No open conversion jobs.</p>}
            </div>
            <div className="space-y-1">
              <Label>Project</Label>
              <Select value={form.project_id || NONE} onValueChange={(v) => set("project_id", v === NONE ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {correction ? (
            <div className="space-y-1">
              <Label>Reason for correction *</Label>
              <Textarea value={form.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Why is this entry being adjusted?" />
              <p className="text-xs text-muted-foreground">The original entry is reversed and an adjusting journal is posted — nothing is overwritten.</p>
            </div>
          ) : !clerk ? (
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" />
            </div>
          ) : null}
          {!clerk && <p className="text-xs text-muted-foreground">Amounts are calculated from the employee's pay setup when saved. Unassigned entries post to direct labour (cost of goods); allowances post to the allowance expense account.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.employee_id || saving || (correction && !form.reason.trim())}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{correction ? "Post correction" : "Save entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function TimesheetDialog({ open, onOpenChange, weekStart, employees, projects, jobs, lines, saving, onSave, clerk }: any) {
  const blankRows = () =>
    DAY_NAMES.map((_, i) => ({ days: "0", hours: "0", overtime_hours: "0", project_id: "", conversion_id: "" }));
  const [employeeId, setEmployeeId] = useState("");
  const [rows, setRows] = useState<any[]>(blankRows);
  const [allowance, setAllowance] = useState("0");
  const [allowanceLabel, setAllowanceLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [bulkJob, setBulkJob] = useState("");
  const [bulkProject, setBulkProject] = useState("");
  const [seeded, setSeeded] = useState(false);

  if (open && !seeded) {
    setSeeded(true);
    setEmployeeId("");
    setRows(blankRows());
    setAllowance("0");
    setAllowanceLabel("");
    setNotes("");
    setBulkJob("");
    setBulkProject("");
  }
  if (!open && seeded) setSeeded(false);

  const emp = employees.find((e: any) => e.id === employeeId);
  const hourly = emp?.pay_basis === "hourly";
  const setRow = (i: number, patch: any) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const existing = (lines as any[]).filter((l) => l.employee_id === employeeId);
  const totals = rows.reduce(
    (t, r) => ({
      days: t.days + (Number(r.days) || 0),
      hours: t.hours + (Number(r.hours) || 0),
      ot: t.ot + (Number(r.overtime_hours) || 0),
    }),
    { days: 0, hours: 0, ot: 0 },
  );

  const filled = rows
    .map((r, i) => ({ ...r, date: `${DAY_NAMES[i]} ${addDays(weekStart, i)}` }))
    .filter((r) => (Number(r.days) || 0) > 0 || (Number(r.hours) || 0) > 0 || (Number(r.overtime_hours) || 0) > 0);

  const quickFill = () =>
    setRows((rs) => rs.map((r, i) => (i < 5 ? { ...r, days: hourly ? r.days : "1", hours: hourly ? "8" : r.hours } : r)));

  const applyJobToAll = (v: string, kind: "job" | "project") =>
    setRows((rs) => rs.map((r) => (kind === "job" ? { ...r, conversion_id: v } : { ...r, project_id: v })));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Weekly timesheet — {weekStart} → {addDays(weekStart, 6)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Employee *</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Select weekly-paid employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e: any) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}{e.code ? ` · ${e.code}` : ""}{clerk ? "" : ` — ${e.pay_basis}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {employees.length === 0 && <p className="text-xs text-muted-foreground">No weekly-paid employees yet.</p>}
            </div>
            <div className="flex items-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={quickFill} disabled={!employeeId}>
                Fill Mon–Fri ({hourly ? "8 hrs" : "1 day"})
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRows(blankRows())}>Clear</Button>
            </div>
          </div>

          {existing.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {existing.length} entr{existing.length === 1 ? "y" : "ies"} already recorded for this employee this week — new days are added on top.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Apply conversion job to all days</Label>
              <Select value={bulkJob || NONE} onValueChange={(v) => { const val = v === NONE ? "" : v; setBulkJob(val); applyJobToAll(val, "job"); }}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {jobs.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.conversion_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Apply project to all days</Label>
              <Select value={bulkProject || NONE} onValueChange={(v) => { const val = v === NONE ? "" : v; setBulkProject(val); applyJobToAll(val, "project"); }}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Day</TableHead>
                  <TableHead className="w-[90px]">Days</TableHead>
                  <TableHead className="w-[90px]">Hours</TableHead>
                  {!clerk && <TableHead className="w-[90px]">OT hrs</TableHead>}
                  <TableHead>Conversion job</TableHead>
                  <TableHead>Project</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">
                      <div className="font-medium">{DAY_NAMES[i]}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{addDays(weekStart, i)}</div>
                    </TableCell>
                    <TableCell>
                      <Input type="number" step="0.5" min="0" disabled={hourly} value={r.days} onChange={(e) => setRow(i, { days: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" step="0.25" min="0" disabled={!hourly} value={r.hours} onChange={(e) => setRow(i, { hours: e.target.value })} />
                    </TableCell>
                    {!clerk && (
                    <TableCell>
                      <Input type="number" step="0.25" min="0" value={r.overtime_hours} onChange={(e) => setRow(i, { overtime_hours: e.target.value })} />
                    </TableCell>
                    )}
                    <TableCell>
                      <Select value={r.conversion_id || NONE} onValueChange={(v) => setRow(i, { conversion_id: v === NONE ? "" : v })}>
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>— None —</SelectItem>
                          {jobs.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.conversion_number}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={r.project_id || NONE} onValueChange={(v) => setRow(i, { project_id: v === NONE ? "" : v })}>
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>— None —</SelectItem>
                          {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <span>Total days: <span className="font-mono font-semibold">{totals.days}</span></span>
            <span>Total hours: <span className="font-mono font-semibold">{totals.hours}</span></span>
            {!clerk && <span>Total overtime: <span className="font-mono font-semibold">{totals.ot}</span></span>}
            <span className="text-muted-foreground">{filled.length} day{filled.length === 1 ? "" : "s"} will be saved</span>
          </div>

          {!clerk && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Allowance (week)</Label>
              <Input type="number" step="0.01" min="0" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
              <p className="text-[10px] text-muted-foreground">Added once for the week, not per day.</p>
            </div>
            <div className="space-y-1">
              <Label>Allowance description</Label>
              <Input value={allowanceLabel} onChange={(e) => setAllowanceLabel(e.target.value)} placeholder="e.g. Transport, meals" />
            </div>
          </div>
          )}

          {!clerk && <div className="space-y-1">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — applied to every day saved" />
          </div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => onSave({ employee_id: employeeId, rows: filled, allowance, allowance_label: allowanceLabel, notes })}
            disabled={!employeeId || filled.length === 0 || saving}
          >
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save timesheet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkEntryDialog({ open, onOpenChange, weekStart, employees, projects, jobs, lines, saving, onSave, clerk }: any) {
  const [dayIdx, setDayIdx] = useState<number[]>([0]);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [rows, setRows] = useState<Record<string, any>>({});
  const [seeded, setSeeded] = useState(false);

  if (open && !seeded) {
    setSeeded(true);
    setDayIdx([0]);
    setSearch("");
    setPicked({});
    setRows({});
  }
  if (!open && seeded) setSeeded(false);

  const rowOf = (id: string) => rows[id] ?? { days: "0", hours: "0", overtime_hours: "0", project_id: "", conversion_id: "" };
  const setRow = (id: string, patch: any) => setRows((rs) => ({ ...rs, [id]: { ...rowOf(id), ...patch } }));

  const dates = dayIdx.slice().sort((a, b) => a - b).map((i) => `${DAY_NAMES[i]} ${addDays(weekStart, i)}`);

  const filtered = (employees as any[]).filter((e) =>
    !search.trim() || `${e.name} ${e.code ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const alreadyFor = (employeeId: string) =>
    (lines as any[]).filter(
      (l) => l.employee_id === employeeId && dates.some((d) => (l.notes ?? "").includes(d)),
    ).length;

  const selectedIds = filtered.filter((e: any) => picked[e.id]).map((e: any) => e.id);
  const toggleAll = () => {
    const all = selectedIds.length === filtered.length && filtered.length > 0;
    const next: Record<string, boolean> = { ...picked };
    filtered.forEach((e: any) => { next[e.id] = !all; });
    setPicked(next);
  };

  const applyToSelected = (patch: any) =>
    setRows((rs) => {
      const next = { ...rs };
      selectedIds.forEach((id) => {
        const emp = (employees as any[]).find((e) => e.id === id);
        const base = next[id] ?? { days: "0", hours: "0", overtime_hours: "0", project_id: "", conversion_id: "" };
        const p = typeof patch === "function" ? patch(emp) : patch;
        next[id] = { ...base, ...p };
      });
      return next;
    });

  const entries = selectedIds.flatMap((id) => {
    const r = rowOf(id);
    const emp = (employees as any[]).find((e) => e.id === id);
    if (!((Number(r.days) || 0) > 0 || (Number(r.hours) || 0) > 0 || (Number(r.overtime_hours) || 0) > 0)) return [];
    return dates.map((d) => ({
      employee_id: id,
      employee_name: emp?.name ?? "Employee",
      date: d,
      days: r.days,
      hours: r.hours,
      overtime_hours: r.overtime_hours,
      project_id: r.project_id,
      conversion_id: r.conversion_id,
    }));
  });

  const totals = entries.reduce(
    (t, e) => ({
      days: t.days + (Number(e.days) || 0),
      hours: t.hours + (Number(e.hours) || 0),
      ot: t.ot + (Number(e.overtime_hours) || 0),
    }),
    { days: 0, hours: 0, ot: 0 },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk attendance — week {weekStart} → {addDays(weekStart, 6)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Day(s)</Label>
            <div className="flex flex-wrap gap-2">
              {DAY_NAMES.map((d, i) => {
                const on = dayIdx.includes(i);
                return (
                  <Button
                    key={d}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    onClick={() => setDayIdx((xs) => (on ? xs.filter((x) => x !== i) : [...xs, i]))}
                  >
                    {d} <span className="ms-1 text-[10px] opacity-70 font-mono">{addDays(weekStart, i).slice(5)}</span>
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Each ticked employee is saved once per selected day.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Search employees</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or code" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Apply standard time</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={selectedIds.length === 0}
                onClick={() => applyToSelected((emp: any) => (emp?.pay_basis === "hourly" ? { hours: "8" } : { days: "1" }))}
              >
                1 day / 8 hrs
              </Button>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Apply job to selected</Label>
              <Select value={NONE} onValueChange={(v) => applyToSelected({ conversion_id: v === NONE ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {jobs.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.conversion_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Apply project to selected</Label>
              <Select value={NONE} onValueChange={(v) => applyToSelected({ project_id: v === NONE ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={filtered.length > 0 && selectedIds.length === filtered.length}
                      onCheckedChange={toggleAll}
                      aria-label="Select all employees"
                    />
                  </TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead className="w-[90px]">Days</TableHead>
                  <TableHead className="w-[90px]">Hours</TableHead>
                  {!clerk && <TableHead className="w-[90px]">OT hrs</TableHead>}
                  <TableHead>Conversion job</TableHead>
                  <TableHead>Project</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={clerk ? 6 : 7} className="text-center py-6 text-muted-foreground">No employees match.</TableCell></TableRow>
                ) : filtered.map((e: any) => {
                  const r = rowOf(e.id);
                  const hourly = e.pay_basis === "hourly";
                  const dup = alreadyFor(e.id);
                  return (
                    <TableRow key={e.id} className={picked[e.id] ? "" : "opacity-60"}>
                      <TableCell>
                        <Checkbox
                          checked={!!picked[e.id]}
                          onCheckedChange={() => setPicked((p) => ({ ...p, [e.id]: !p[e.id] }))}
                          aria-label={`Select ${e.name}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{e.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {e.code ?? ""}{clerk ? "" : ` · ${e.pay_basis}`}
                        </div>
                        {dup > 0 && <div className="text-[10px] text-warning">Already recorded on {dup} selected day{dup === 1 ? "" : "s"}</div>}
                      </TableCell>
                      <TableCell>
                        <Input type="number" step="0.5" min="0" disabled={hourly || !picked[e.id]} value={r.days} onChange={(ev) => setRow(e.id, { days: ev.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" step="0.25" min="0" disabled={!hourly || !picked[e.id]} value={r.hours} onChange={(ev) => setRow(e.id, { hours: ev.target.value })} />
                      </TableCell>
                      {!clerk && (
                        <TableCell>
                          <Input type="number" step="0.25" min="0" disabled={!picked[e.id]} value={r.overtime_hours} onChange={(ev) => setRow(e.id, { overtime_hours: ev.target.value })} />
                        </TableCell>
                      )}
                      <TableCell>
                        <Select value={r.conversion_id || NONE} onValueChange={(v) => setRow(e.id, { conversion_id: v === NONE ? "" : v })} disabled={!picked[e.id]}>
                          <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>— None —</SelectItem>
                            {jobs.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.conversion_number}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={r.project_id || NONE} onValueChange={(v) => setRow(e.id, { project_id: v === NONE ? "" : v })} disabled={!picked[e.id]}>
                          <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>— None —</SelectItem>
                            {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <span>Employees selected: <span className="font-mono font-semibold">{selectedIds.length}</span></span>
            <span>Total days: <span className="font-mono font-semibold">{totals.days}</span></span>
            <span>Total hours: <span className="font-mono font-semibold">{totals.hours}</span></span>
            {!clerk && <span>Total overtime: <span className="font-mono font-semibold">{totals.ot}</span></span>}
            <span className="text-muted-foreground">{entries.length} entr{entries.length === 1 ? "y" : "ies"} will be saved</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave({ entries })} disabled={entries.length === 0 || dates.length === 0 || saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save {entries.length || ""} entr{entries.length === 1 ? "y" : "ies"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Week totals grouped by project, then job, then employee. */
function ProjectAttendanceView({ byProject, restricted, currency, onExport }: any) {
  if (!byProject.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No attendance recorded for this week yet.</p>;
  }
  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onExport}>Export CSV</Button>
      </div>
      {byProject.map((p: any) => (
        <div key={p.key} className="rounded-md border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
            <div className="font-medium">{p.name}</div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>{p.days} days</span>
              <span>{p.hours} hrs</span>
              {!restricted && <span>{p.ot} OT hrs</span>}
              {!restricted && <span className="font-mono font-semibold text-foreground">{formatMoney(p.amount, currency)}</span>}
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                {!restricted && <TableHead className="text-right">OT hrs</TableHead>}
                {!restricted && <TableHead className="text-right">Amount</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.jobs.map((j: any) =>
                j.employees.map((e: any, i: number) => (
                  <TableRow key={`${j.key}-${e.key}`}>
                    <TableCell className="text-sm">{i === 0 ? j.name : ""}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{e.name}</div>
                      {e.code ? <div className="font-mono text-xs text-muted-foreground">{e.code}</div> : null}
                    </TableCell>
                    <TableCell className="text-right font-mono">{e.days}</TableCell>
                    <TableCell className="text-right font-mono">{e.hours}</TableCell>
                    {!restricted && <TableCell className="text-right font-mono">{e.ot}</TableCell>}
                    {!restricted && <TableCell className="text-right font-mono">{formatMoney(e.amount, currency)}</TableCell>}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
}

/** Maintain the organisation's public holiday list — days worked then earn the holiday premium. */
function HolidaysDialog({ open, onOpenChange, holidays, onChanged }: any) {
  const { toast } = useToast();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!date || !name.trim()) return;
    setBusy(true);
    const { error } = await (supabase as any).from("public_holidays").insert({ holiday_date: date, name: name.trim() });
    setBusy(false);
    if (error) { toast({ title: "Could not add holiday", description: error.message, variant: "destructive" }); return; }
    setDate(""); setName("");
    onChanged();
  };

  const remove = async (id: string) => {
    const { error } = await (supabase as any).from("public_holidays").delete().eq("id", id);
    if (error) { toast({ title: "Could not remove", description: error.message, variant: "destructive" }); return; }
    onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Public holidays</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Time recorded on these dates earns the holiday rate set for your organisation (2x by default).</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>Date</Label>
            <Input type="date" className="w-[160px]" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex-1 space-y-1 min-w-[160px]">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jamhuri Day" />
          </div>
          <Button onClick={add} disabled={busy || !date || !name.trim()}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}Add
          </Button>
        </div>
        <div className="max-h-[40vh] space-y-1 overflow-y-auto">
          {holidays.length === 0 ? (
            <p className="text-sm text-muted-foreground">No holidays recorded yet.</p>
          ) : holidays.map((h: any) => (
            <div key={h.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
              <span><span className="font-mono">{h.holiday_date}</span> — {h.name}</span>
              <Button size="icon" variant="ghost" onClick={() => remove(h.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
