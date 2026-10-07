# Bulk weekly attendance entry

Today attendance is entered one employee at a time: the weekly timesheet dialog covers a full week but only for a single person. This adds a bulk screen where one day (or several days) can be recorded for many employees at once.

## What changes

A new **Bulk entry** button on the attendance week opens a dialog with:

1. **Day selector** — pick one day of the week (Mon–Sun, with dates shown), or tick several days to repeat the same entry across them.
2. **Employee list** — all weekly-paid employees, each with a tick box. "Select all" and a name search box for quick filtering. Employees who already have an entry for the chosen day are flagged so nothing is double-entered.
3. **Per-employee row** — days or hours (whichever matches that person's pay basis), overtime hours, and a job/project picker.
4. **Apply to all** controls at the top: set a standard value (1 day / 8 hours), a job, or a project across every ticked row in one click, then adjust individual rows as needed.
5. **Live totals** — number of employees selected, total days, hours, and overtime that will be saved.
6. **Save once** — every ticked employee × selected day becomes an attendance line.

Behaviour details:
- Only ticked employees with time on them are saved; empty rows are skipped.
- Approved weeks stay locked; bulk entry is only offered on draft weeks.
- Allowances are not part of bulk entry (they stay per-employee in the existing weekly timesheet) to avoid accidentally repeating money across a crowd.
- For a clerk-restricted user (attendance-only access), the overtime column and any money columns are hidden, exactly as in the existing timesheet dialog.
- If one employee's line fails, the toast names that employee; the rest that already saved remain (the week is a draft, so they can be edited or deleted).

## Technical notes

- Single file change: `src/pages/hrm/Attendance.tsx` — a new `BulkEntryDialog` component plus a `saveBulk` mutation. No schema or RPC changes.
- Saving loops the existing `upsert_attendance_line` RPC (one call per employee per selected day, sequential, inside one mutation), the same pattern the current `saveTimesheet` mutation uses, and writes the day into `notes` as a date prefix so the day stays visible and reportable.
- `ensureWeek()` is reused so the attendance week is created on first save.
- Reuses existing `employees`, `projects`, and `jobs` queries already loaded on the page.
