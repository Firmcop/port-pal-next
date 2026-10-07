# One-shot weekly timesheet entry per employee

Today, adding attendance means opening the dialog once per line: one employee, one job, one set of hours. Recording a week where someone worked three jobs means three separate saves.

## What changes

A new "Weekly timesheet" action on the attendance week opens a single dialog where you:

1. Pick one employee (weekly-paid).
2. Fill a Mon–Sun row grid: each day has days-or-hours (depending on the employee's pay basis), overtime hours, and a job or project picker.
3. Optionally add allowance amount and label for the week.
4. Save once — every day with time on it becomes an attendance line for that week.

Helpers in the dialog:
- "Apply to all days" for the job/project so a full week on one job takes one selection.
- Quick fill: set a standard day value (e.g. 1 day / 8 hours) across Mon–Fri.
- Live totals at the top: total days, total hours, total overtime for the week.
- Days already recorded for that employee this week are shown so nothing is double-entered.

The existing single "Add entry" dialog stays for one-off corrections; approved weeks stay locked and still use the correction flow only.

## Grouping in the table

Lines are grouped by employee with a per-employee subtotal row, so a person split across several jobs reads as one block instead of scattered rows.

## Technical notes

- `attendance_lines` has no per-day column and allows several rows per employee per week, so each timesheet day saves as its own line via the existing `upsert_attendance_line` RPC (looped, sequentially, in one mutation). The day is written into `notes` as a date prefix so it stays visible and reportable.
- Allowance is attached once to the first saved line of the batch to avoid multiplying it across days.
- Files: `src/pages/hrm/Attendance.tsx` only — new `TimesheetDialog` component plus employee grouping in the lines table. No schema or RPC changes.
- Partial failure surfaces a toast naming the day that failed; already-saved days remain (the week is a draft, so they can be edited or deleted).
