/** Staff tasks (HR > Weekly Attendance > Tasks): shared types and helpers. */

export type TaskStatus = "open" | "complete" | "incomplete";

export interface WorkTask {
  id: string;
  employee_id: string | null;
  assignee_name: string | null;
  work_date: string;
  title: string;
  details: string | null;
  conversion_id: string | null;
  project_id: string | null;
  status: TaskStatus;
  incomplete_reason: string | null;
  sheet_signed: boolean;
  recorded_at: string | null;
  carried_from_id: string | null;
  employee?: { name: string; code?: string | null } | null;
  conversion?: { conversion_number: string; product_name?: string | null } | null;
  project?: { name: string } | null;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Not recorded",
  complete: "Complete",
  incomplete: "Incomplete",
};

export const INCOMPLETE_REASONS = [
  "Materials not available",
  "Waiting for another task",
  "Rework needed",
  "Equipment / power problem",
  "Weather",
  "Absent or left early",
  "Moved to another job",
  "Other",
] as const;

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function iso(dt: Date) {
  return dt.toISOString().slice(0, 10);
}
export function addDaysIso(date: string, n: number) {
  const dt = parse(date);
  dt.setUTCDate(dt.getUTCDate() + n);
  return iso(dt);
}

/** The seven days of the week starting at weekStart (a Monday). */
export function weekDays(weekStart: string) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysIso(weekStart, i);
    const dt = parse(date);
    const short = `${DAY[dt.getUTCDay()]} ${dt.getUTCDate()}`;
    return { date, short, label: `${DAY[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTH[dt.getUTCMonth()]}` };
  });
}

/** The next working day for a carried-over task (Sunday is skipped). */
export function nextWorkDay(date: string) {
  let next = addDaysIso(date, 1);
  if (parse(next).getUTCDay() === 0) next = addDaysIso(next, 1);
  return next;
}

export interface StaffSummary {
  key: string;
  name: string;
  total: number;
  complete: number;
  incomplete: number;
  open: number;
  /** complete ÷ recorded (complete + incomplete); null when nothing is recorded yet */
  completionPct: number | null;
}

export function summariseByStaff(tasks: WorkTask[]): StaffSummary[] {
  const m = new Map<string, StaffSummary>();
  for (const t of tasks) {
    const key = t.employee_id ?? `name:${t.assignee_name ?? ""}`;
    const s = m.get(key) ?? {
      key, name: t.employee?.name ?? t.assignee_name ?? "—", total: 0, complete: 0, incomplete: 0, open: 0, completionPct: null,
    };
    s.total += 1;
    s[t.status] += 1;
    m.set(key, s);
  }
  return [...m.values()]
    .map((s) => {
      const recorded = s.complete + s.incomplete;
      return { ...s, completionPct: recorded ? Math.round((s.complete / recorded) * 100) : null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Printable sheet the staff sign: one table per day, a row per task, with
 * Complete / Incomplete boxes, a reason column and a signature column. The
 * supervisor records the outcome in the app from the signed copy.
 */
export function buildTaskSheetHtml({ tasks, companyName, weekStart, weekEnd, day }: {
  tasks: WorkTask[]; companyName?: string | null; weekStart: string; weekEnd: string; day: string | null;
}) {
  const days = weekDays(weekStart);
  const label = (d: string) => days.find((x) => x.date === d)?.label ?? d;
  const byDay = new Map<string, WorkTask[]>();
  for (const t of [...tasks].sort((a, b) =>
    a.work_date.localeCompare(b.work_date) ||
    (a.employee?.name ?? a.assignee_name ?? "").localeCompare(b.employee?.name ?? b.assignee_name ?? ""))) {
    byDay.set(t.work_date, [...(byDay.get(t.work_date) ?? []), t]);
  }

  const sections = [...byDay.entries()].map(([date, rows]) => `
    <section>
      <h2>${esc(label(date))}</h2>
      <table>
        <thead><tr>
          <th style="width:16%">Staff</th><th>Task</th><th style="width:15%">Job / Project</th>
          <th class="box">Complete</th><th class="box">Incomplete</th>
          <th style="width:16%">Reason if incomplete</th><th style="width:15%">Signature</th>
        </tr></thead>
        <tbody>
          ${rows.map((t) => `<tr>
            <td>${esc(t.employee?.name ?? t.assignee_name)}</td>
            <td><b>${esc(t.title)}</b>${t.details ? `<div class="sub">${esc(t.details)}</div>` : ""}</td>
            <td>${esc(t.conversion?.conversion_number ?? "")}${t.project?.name ? `<div class="sub">${esc(t.project.name)}</div>` : ""}</td>
            <td class="box">☐</td><td class="box">☐</td><td></td><td></td>
          </tr>`).join("")}
        </tbody>
      </table>
      <div class="foot">Supervisor: ____________________________ &nbsp; Signature: ______________________ &nbsp; Date: ______________</div>
    </section>`).join("");

  const title = day ? `Daily task sheet — ${label(day)}` : `Weekly task sheet — ${weekStart} to ${weekEnd}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #111; }
    header { display:flex; justify-content:space-between; align-items:baseline; border-bottom:2px solid #111; margin-bottom:8px; }
    h1 { font-size: 16px; margin: 0 0 4px; } h2 { font-size: 13px; margin: 12px 0 4px; }
    table { width:100%; border-collapse: collapse; }
    th, td { border:1px solid #444; padding:6px 5px; vertical-align: top; text-align:left; }
    th { background:#eee; font-size:10px; text-transform:uppercase; }
    td { height: 26px; } .box { width:7%; text-align:center; font-size:15px; }
    .sub { color:#555; font-size:10px; margin-top:2px; }
    .foot { margin-top:10px; font-size:11px; }
    section { page-break-inside: avoid; } section + section { page-break-before: auto; }
    .note { color:#555; font-size:10px; margin-top:12px; }
  </style></head><body>
  <header><h1>${esc(companyName ?? "")} — ${esc(title)}</h1><span>Printed ${esc(new Date().toISOString().slice(0, 10))}</span></header>
  ${sections || "<p>No tasks.</p>"}
  <p class="note">Each staff member ticks Complete or Incomplete for their own task and signs. The supervisor records the result in Port Pal (HR → Weekly Attendance → Tasks) and keeps this sheet.</p>
  </body></html>`;
}
