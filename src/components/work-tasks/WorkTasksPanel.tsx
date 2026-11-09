import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@/lib/router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, CornerDownRight, Loader2, Plus } from "lucide-react";
import { TASK_STATUS_LABEL, type TaskStatus, type WorkTask, summariseByStaff } from "@/lib/work-tasks";

const statusBadge: Record<TaskStatus, string> = {
  open: "bg-muted text-muted-foreground",
  complete: "bg-success/15 text-success",
  incomplete: "bg-destructive/15 text-destructive",
};

/**
 * Staff tasks for one conversion job or one project: the same records as
 * HR > Weekly Attendance > Tasks, where the supervisor records complete /
 * incomplete from the signed sheet.
 */
export function WorkTasksPanel({ conversionId, projectId, canAdd = true }: {
  conversionId?: string; projectId?: string; canAdd?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const key = conversionId ? ["conversion-work-tasks", conversionId] : ["project-work-tasks", projectId];

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: key,
    enabled: !!(conversionId || projectId),
    queryFn: async () => {
      let q = (supabase as any).from("work_tasks")
        .select("*, employee:employee_id(name), conversion:conversion_id(conversion_number)")
        .order("work_date", { ascending: false }).order("created_at", { ascending: false });
      q = conversionId ? q.eq("conversion_id", conversionId) : q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as WorkTask[];
    },
  });

  const recorded = tasks.filter((t) => t.status !== "open");
  const complete = tasks.filter((t) => t.status === "complete").length;
  const pct = tasks.length ? Math.round((complete / tasks.length) * 100) : 0;
  const staff = useMemo(() => summariseByStaff(tasks), [tasks]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4" />Work tasks</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" asChild><Link to="/hrm/attendance">Record in attendance</Link></Button>
          {canAdd && <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-1 h-4 w-4" />Add task</Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {tasks.length > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>{complete} of {tasks.length} tasks complete</span>
              <span className="text-muted-foreground">
                {tasks.filter((t) => t.status === "incomplete").length} incomplete · {tasks.length - recorded.length} not recorded
              </span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
        )}
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : tasks.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No tasks yet. Supervisors add them here or under HR → Weekly Attendance → Tasks.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Task</TableHead>
                {!conversionId && <TableHead>Job</TableHead>}
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap text-sm">{t.work_date}</TableCell>
                  <TableCell className="whitespace-nowrap">{t.employee?.name ?? t.assignee_name}</TableCell>
                  <TableCell>
                    <div className="font-medium">{t.title}</div>
                    {t.carried_from_id && <div className="flex items-center gap-1 text-xs text-muted-foreground"><CornerDownRight className="h-3 w-3" />carried over</div>}
                  </TableCell>
                  {!conversionId && <TableCell className="font-mono text-xs">{t.conversion?.conversion_number ?? "—"}</TableCell>}
                  <TableCell>
                    <Badge variant="secondary" className={statusBadge[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
                    {t.incomplete_reason && <div className="mt-1 text-xs text-destructive">{t.incomplete_reason}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {staff.length > 1 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {staff.map((s) => (
              <Badge key={s.key} variant="outline">{s.name}: {s.complete}/{s.total}{s.incomplete ? ` · ${s.incomplete} incomplete` : ""}</Badge>
            ))}
          </div>
        )}
      </CardContent>
      <AddTaskDialog open={addOpen} onOpenChange={setAddOpen} conversionId={conversionId} projectId={projectId}
        onSaved={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["work-tasks"] }); }}
        onError={(e: any) => toast({ title: "Could not add task", description: e?.message, variant: "destructive" })} />
    </Card>
  );
}

function AddTaskDialog({ open, onOpenChange, conversionId, projectId, onSaved, onError }: any) {
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [staff, setStaff] = useState<string[]>([]);
  const { data: employees = [] } = useQuery({
    queryKey: ["work-task-employees"],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase as any).from("employees").select("id,name").eq("status", "active").order("name");
      return data ?? [];
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const rows = staff.map((employee_id) => ({
        employee_id, work_date: date, title: title.trim(),
        conversion_id: conversionId ?? null, project_id: projectId ?? null,
      }));
      const { error } = await (supabase as any).from("work_tasks").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => { setTitle(""); setStaff([]); onSaved(); },
    onError,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add task</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Task</Label>
            <Input value={title} maxLength={120} placeholder="e.g. Fit windows and doors" onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1"><Label>Day</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1"><Label>Staff (one or more)</Label>
            <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2">
              {employees.map((e: any) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                  <Checkbox checked={staff.includes(e.id)}
                    onCheckedChange={() => setStaff((s) => s.includes(e.id) ? s.filter((x) => x !== e.id) : [...s, e.id])} />
                  <span className="truncate">{e.name}</span>
                </label>
              ))}
            </div></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!title.trim() || !date || !staff.length || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
