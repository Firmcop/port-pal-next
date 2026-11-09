import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, CircleDashed, CornerDownRight, Loader2, Pencil, Plus, Printer, Trash2, XCircle } from "lucide-react";
import {
  INCOMPLETE_REASONS, TASK_STATUS_LABEL, type TaskStatus, type WorkTask,
  buildTaskSheetHtml, nextWorkDay, summariseByStaff, weekDays,
} from "@/lib/work-tasks";

const NONE = "none";
const ALL = "all";

const statusBadge: Record<TaskStatus, string> = {
  open: "bg-muted text-muted-foreground",
  complete: "bg-success/15 text-success",
  incomplete: "bg-destructive/15 text-destructive",
};

/**
 * HR > Weekly Attendance > Tasks. Supervisors assign tasks per person per day
 * (optional, several allowed), print the sheet staff sign, then record each
 * task as complete or incomplete from the signed copy. Performance only:
 * pay stays on the attendance entries.
 */
export function WeekTasks({ weekStart, weekEnd, jobs, projects, canEdit, companyName }: {
  weekStart: string;
  weekEnd: string;
  jobs: { id: string; conversion_number: string }[];
  projects: { id: string; name: string }[];
  canEdit: boolean;
  companyName?: string | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const [day, setDay] = useState<string>(ALL);
  const [staff, setStaff] = useState<string>(ALL);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<WorkTask | null>(null);
  const [incompleteFor, setIncompleteFor] = useState<WorkTask[] | null>(null);

  const { data: org } = useQuery({
    queryKey: ["org-legal-name"],
    enabled: !companyName,
    queryFn: async () => {
      const { data } = await (supabase as any).from("organizations").select("name, legal_name").limit(1).maybeSingle();
      return data as { name: string; legal_name: string | null } | null;
    },
  });
  const company = companyName ?? org?.legal_name ?? org?.name ?? "";

  const key = ["work-tasks", weekStart];
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("work_tasks")
        .select("*, employee:employee_id(name, code), conversion:conversion_id(conversion_number, product_name), project:project_id(name)")
        .gte("work_date", weekStart).lte("work_date", weekEnd)
        .order("work_date").order("created_at");
      if (error) throw error;
      return (data ?? []) as WorkTask[];
    },
  });

  // Tasks are for anyone on staff, not only weekly-paid workers.
  const { data: employees = [] } = useQuery({
    queryKey: ["work-task-employees"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("employees").select("id,name,code").eq("status", "active").order("name");
      return (data ?? []) as { id: string; name: string; code: string | null }[];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["conversion-work-tasks"] });
    qc.invalidateQueries({ queryKey: ["project-work-tasks"] });
  };
  const fail = (e: any) => toast({ title: "Could not save", description: e?.message ?? String(e), variant: "destructive" });

  const visible = tasks.filter((t) => (day === ALL || t.work_date === day) && (staff === ALL || t.employee_id === staff));
  const byDay = useMemo(() => {
    const m = new Map<string, WorkTask[]>();
    for (const t of visible) m.set(t.work_date, [...(m.get(t.work_date) ?? []), t]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);
  const summary = useMemo(() => summariseByStaff(visible), [visible]);
  const counts = { total: visible.length, ...Object.fromEntries((["open", "complete", "incomplete"] as TaskStatus[]).map((s) => [s, visible.filter((t) => t.status === s).length])) } as Record<string, number>;

  const setStatus = useMutation({
    mutationFn: async ({ ids, status, reason }: { ids: string[]; status: TaskStatus; reason?: string }) => {
      const { error } = await (supabase as any).from("work_tasks")
        .update({ status, incomplete_reason: status === "incomplete" ? reason : null, ...(status !== "open" ? { sheet_signed: true } : {}) })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_d, v) => { setSelected(new Set()); setIncompleteFor(null); refresh(); toast({ title: `${v.ids.length} task${v.ids.length === 1 ? "" : "s"} marked ${TASK_STATUS_LABEL[v.status].toLowerCase()}` }); },
    onError: fail,
  });

  const toggleSigned = useMutation({
    mutationFn: async (t: WorkTask) => {
      const { error } = await (supabase as any).from("work_tasks").update({ sheet_signed: !t.sheet_signed }).eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: refresh, onError: fail,
  });

  const carryOver = useMutation({
    mutationFn: async (t: WorkTask) => {
      const { error } = await (supabase as any).from("work_tasks").insert({
        employee_id: t.employee_id, assignee_name: t.assignee_name, work_date: nextWorkDay(t.work_date),
        title: t.title, details: t.details, conversion_id: t.conversion_id, project_id: t.project_id, carried_from_id: t.id,
      });
      if (error) throw error;
    },
    onSuccess: (_d, t) => { refresh(); toast({ title: `Carried over to ${nextWorkDay(t.work_date)}` }); },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: async (t: WorkTask) => {
      const { error } = await (supabase as any).from("work_tasks").delete().eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: refresh, onError: fail,
  });

  const print = () => {
    const html = buildTaskSheetHtml({
      tasks: visible, companyName: company, weekStart, weekEnd, day: day === ALL ? null : day,
    });
    const w = window.open("", "_blank", "width=1000,height=750");
    if (!w) { toast({ title: "Allow pop-ups to print the task sheet", variant: "destructive" }); return; }
    w.document.write(html); w.document.close(); setTimeout(() => w.print(), 300);
  };

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedTasks = tasks.filter((t) => selected.has(t.id));

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={day} onValueChange={setDay}>
          <SelectTrigger className="w-[170px] h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Whole week</SelectItem>
            {days.map((d) => <SelectItem key={d.date} value={d.date}>{d.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={staff} onValueChange={setStaff}>
          <SelectTrigger className="w-[190px] h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All staff</SelectItem>
            {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex gap-1.5 text-xs">
          <Badge variant="outline">{counts.total} tasks</Badge>
          <Badge variant="secondary" className={statusBadge.complete}>{counts.complete} complete</Badge>
          <Badge variant="secondary" className={statusBadge.incomplete}>{counts.incomplete} incomplete</Badge>
          <Badge variant="secondary" className={statusBadge.open}>{counts.open} open</Badge>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={print} disabled={visible.length === 0}>
            <Printer className="mr-1 h-4 w-4" />Print sign sheet
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-1 h-4 w-4" />Add tasks</Button>
          )}
        </div>
      </div>

      {canEdit && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span>{selected.size} selected — from the signed sheet:</span>
          <Button size="sm" variant="outline" className="h-7" disabled={setStatus.isPending}
            onClick={() => setStatus.mutate({ ids: [...selected], status: "complete" })}>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-success" />Complete
          </Button>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setIncompleteFor(selectedTasks)}>
            <XCircle className="mr-1 h-3.5 w-3.5 text-destructive" />Incomplete…
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : visible.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          No tasks {day === ALL ? "this week" : "on this day"}. Tasks are optional — add them for staff whose work you want to track.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {canEdit && <TableHead className="w-8" />}
              <TableHead>Staff</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Job / Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Signed sheet</TableHead>
              {canEdit && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {byDay.map(([date, rows]) => (
              <Fragment key={date}>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={canEdit ? 7 : 5} className="py-1.5 text-xs font-semibold">
                    {days.find((d) => d.date === date)?.label ?? date}
                  </TableCell>
                </TableRow>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    {canEdit && (
                      <TableCell><Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} /></TableCell>
                    )}
                    <TableCell className="whitespace-nowrap">{t.employee?.name ?? t.assignee_name}</TableCell>
                    <TableCell>
                      <div className="font-medium">{t.title}</div>
                      {t.details && <div className="text-xs text-muted-foreground">{t.details}</div>}
                      {t.carried_from_id && <div className="text-xs text-muted-foreground flex items-center gap-1"><CornerDownRight className="h-3 w-3" />carried over</div>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.conversion?.conversion_number && <div className="font-mono text-xs">{t.conversion.conversion_number}</div>}
                      {t.project?.name && <div className="text-xs text-muted-foreground">{t.project.name}</div>}
                      {!t.conversion_id && !t.project_id && <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant={t.status === "complete" ? "secondary" : "ghost"} className="h-7 w-7" title="Complete"
                            onClick={() => setStatus.mutate({ ids: [t.id], status: "complete" })}>
                            <CheckCircle2 className="h-4 w-4 text-success" />
                          </Button>
                          <Button size="icon" variant={t.status === "incomplete" ? "secondary" : "ghost"} className="h-7 w-7" title="Incomplete"
                            onClick={() => setIncompleteFor([t])}>
                            <XCircle className="h-4 w-4 text-destructive" />
                          </Button>
                          <Button size="icon" variant={t.status === "open" ? "secondary" : "ghost"} className="h-7 w-7" title="Not recorded yet"
                            onClick={() => setStatus.mutate({ ids: [t.id], status: "open" })}>
                            <CircleDashed className="h-4 w-4" />
                          </Button>
                          <Badge variant="secondary" className={statusBadge[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
                        </div>
                      ) : (
                        <Badge variant="secondary" className={statusBadge[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
                      )}
                      {t.status === "incomplete" && t.incomplete_reason && (
                        <div className="mt-1 text-xs text-destructive">{t.incomplete_reason}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox checked={t.sheet_signed} disabled={!canEdit} onCheckedChange={() => toggleSigned.mutate(t)} />
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right whitespace-nowrap">
                        {t.status !== "complete" && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => carryOver.mutate(t)} disabled={carryOver.isPending}>
                            Carry over
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => { if (confirmDelete(t)) remove.mutate(t); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}

      {summary.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Performance {day === ALL ? "this week" : "on this day"}</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead className="text-right">Tasks</TableHead>
                <TableHead className="text-right">Complete</TableHead>
                <TableHead className="text-right">Incomplete</TableHead>
                <TableHead className="text-right">Not recorded</TableHead>
                <TableHead className="text-right">Completion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.map((s) => (
                <TableRow key={s.key}>
                  <TableCell>{s.name}</TableCell>
                  <TableCell className="text-right">{s.total}</TableCell>
                  <TableCell className="text-right text-success">{s.complete}</TableCell>
                  <TableCell className="text-right text-destructive">{s.incomplete}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{s.open}</TableCell>
                  <TableCell className="text-right font-medium">{s.completionPct == null ? "—" : `${s.completionPct}%`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-1 text-xs text-muted-foreground">Completion counts recorded tasks only. Tasks are a performance record; pay comes from the attendance entries.</p>
        </div>
      )}

      <TaskDialog
        open={addOpen || !!editing}
        onOpenChange={(o) => { if (!o) { setAddOpen(false); setEditing(null); } }}
        task={editing}
        days={days}
        defaultDay={day === ALL ? null : day}
        employees={employees}
        jobs={jobs}
        projects={projects}
        onSaved={() => { setAddOpen(false); setEditing(null); refresh(); }}
        onError={fail}
      />

      <IncompleteDialog
        tasks={incompleteFor}
        onOpenChange={(o) => !o && setIncompleteFor(null)}
        saving={setStatus.isPending}
        onSave={(reason) => incompleteFor && setStatus.mutate({ ids: incompleteFor.map((t) => t.id), status: "incomplete", reason })}
      />
    </div>
  );
}

function confirmDelete(t: WorkTask) {
  return typeof window === "undefined" || window.confirm(`Delete the task "${t.title}"?`);
}

function TaskDialog({ open, onOpenChange, task, days, defaultDay, employees, jobs, projects, onSaved, onError }: any) {
  const editing = !!task;
  const [form, setForm] = useState<any>(null);
  const init = () => ({
    staff: task?.employee_id ? [task.employee_id] : [] as string[],
    dates: task ? [task.work_date] : defaultDay ? [defaultDay] : [] as string[],
    title: task?.title ?? "",
    details: task?.details ?? "",
    conversion_id: task?.conversion_id ?? "",
    project_id: task?.project_id ?? "",
  });
  const f = form ?? init();
  const set = (k: string, v: any) => setForm({ ...f, [k]: v });
  const flip = (k: "staff" | "dates", v: string) =>
    set(k, editing ? [v] : f[k].includes(v) ? f[k].filter((x: string) => x !== v) : [...f[k], v]);

  const jobOptions = useMemo(() => {
    const list = [...jobs];
    if (task?.conversion_id && !list.some((j: any) => j.id === task.conversion_id)) {
      list.push({ id: task.conversion_id, conversion_number: task.conversion?.conversion_number ?? "Current job" });
    }
    return list;
  }, [jobs, task]);
  const projectOptions = useMemo(() => {
    const list = [...projects];
    if (task?.project_id && !list.some((p: any) => p.id === task.project_id)) {
      list.push({ id: task.project_id, name: task.project?.name ?? "Current project" });
    }
    return list;
  }, [projects, task]);

  const save = useMutation({
    mutationFn: async () => {
      const base = {
        title: f.title.trim(), details: f.details.trim() || null,
        conversion_id: f.conversion_id || null, project_id: f.project_id || null,
      };
      if (editing) {
        const { error } = await (supabase as any).from("work_tasks")
          .update({ ...base, employee_id: f.staff[0] ?? task.employee_id, work_date: f.dates[0] ?? task.work_date })
          .eq("id", task.id);
        if (error) throw error;
        return 1;
      }
      const rows = f.staff.flatMap((employee_id: string) => f.dates.map((work_date: string) => ({ ...base, employee_id, work_date })));
      const { error } = await (supabase as any).from("work_tasks").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: () => { setForm(null); onSaved(); },
    onError,
  });

  const valid = f.title.trim() && f.staff.length > 0 && f.dates.length > 0;
  const count = f.staff.length * f.dates.length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setForm(null); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{editing ? "Edit task" : "Add tasks"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Task</Label>
            <Input value={f.title} maxLength={120} placeholder="e.g. Weld door frames, unit 2" onChange={(e) => set("title", e.target.value)} />
            <Textarea value={f.details} rows={2} placeholder="Details (optional)" onChange={(e) => set("details", e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Conversion job</Label>
              <Select value={f.conversion_id || NONE} onValueChange={(v) => set("conversion_id", v === NONE ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {jobOptions.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.conversion_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={f.project_id || NONE} onValueChange={(v) => set("project_id", v === NONE ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="From the job, or choose" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None / from the job</SelectItem>
                  {projectOptions.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{editing ? "Day" : "Days"}</Label>
            <div className="flex flex-wrap gap-2">
              {days.map((d: any) => (
                <Button key={d.date} type="button" size="sm" variant={f.dates.includes(d.date) ? "default" : "outline"} className="h-8"
                  onClick={() => flip("dates", d.date)}>{d.short}</Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>{editing ? "Staff" : "Staff (one or more)"}</Label>
            <div className="grid max-h-52 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-3">
              {employees.map((e: any) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                  <Checkbox checked={f.staff.includes(e.id)} onCheckedChange={() => flip("staff", e.id)} />
                  <span className="truncate">{e.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setForm(null); onOpenChange(false); }}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {editing ? "Save" : `Add ${count || ""} task${count === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IncompleteDialog({ tasks, onOpenChange, saving, onSave }: {
  tasks: WorkTask[] | null; onOpenChange: (o: boolean) => void; saving: boolean; onSave: (reason: string) => void;
}) {
  const [reason, setReason] = useState<string>(INCOMPLETE_REASONS[0]);
  const [note, setNote] = useState("");
  const text = reason === "Other" ? note.trim() : note.trim() ? `${reason} — ${note.trim()}` : reason;
  return (
    <Dialog open={!!tasks} onOpenChange={(o) => { if (!o) { setNote(""); setReason(INCOMPLETE_REASONS[0]); } onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Incomplete — why?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          {tasks?.length === 1 ? tasks[0].title : `${tasks?.length ?? 0} tasks`}
        </p>
        <div className="space-y-3">
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{INCOMPLETE_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea rows={2} value={note} placeholder={reason === "Other" ? "Reason" : "Note (optional)"} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={!text || saving} onClick={() => onSave(text)}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Mark incomplete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
