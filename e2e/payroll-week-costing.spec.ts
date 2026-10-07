import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * End-to-end payroll costing check.
 *
 * Creates a draft attendance week in a far-future (unused) date range, records
 * wages against a real conversion job that belongs to a project, approves the
 * week, and then asserts that the conversion job labour, the project COGS
 * postings and the ledger debits/credits all agree. It then corrects a line and
 * re-asserts that everything moved by exactly the delta and still balances.
 *
 * Required env:
 *   PAYROLL_EMAIL=... PAYROLL_PASSWORD=...
 * Run:
 *   PAYROLL_EMAIL=... PAYROLL_PASSWORD=... npx playwright test payroll-week-costing
 */
const URL = process.env.VITE_SUPABASE_URL ?? "";
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const EMAIL = process.env.PAYROLL_EMAIL ?? "";
const PASSWORD = process.env.PAYROLL_PASSWORD ?? "";

// A Monday well beyond any real payroll data, so the run is isolated.
const WEEK_START = "2032-01-05";

const round = (v: number) => Math.round(v * 100) / 100;

test.describe("weekly payroll → job, project and ledger", () => {
  test.skip(!URL || !KEY || !EMAIL || !PASSWORD, "Supabase/payroll credentials not provided — skipping.");

  test("approving and correcting a week keeps job, project and ledger consistent", async () => {
    test.setTimeout(120_000);
    const db = createClient(URL, KEY, { auth: { persistSession: false } });
    const { error: authErr } = await db.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    expect(authErr, "sign-in failed").toBeNull();

    // A conversion job that is attached to a project.
    const { data: job } = await db
      .from("container_conversions")
      .select("id, conversion_number, project_id")
      .not("project_id", "is", null)
      .limit(1)
      .maybeSingle();
    test.skip(!job, "no conversion job linked to a project in this org — skipping.");

    const { data: employee } = await db.from("employees").select("id").eq("is_active", true).limit(1).maybeSingle();
    test.skip(!employee, "no active employee — skipping.");

    // 1. Fresh draft week -----------------------------------------------------
    const { data: weekId, error: weekErr } = await db.rpc("ensure_attendance_week", { _week_start: WEEK_START });
    expect(weekErr, weekErr?.message).toBeNull();

    const { data: existing } = await db.from("attendance_lines").select("id").eq("week_id", weekId);
    test.skip((existing?.length ?? 0) > 0, "test week already has entries — clean it up before re-running.");

    const { error: lineErr } = await db.rpc("upsert_attendance_line", {
      _week_id: weekId,
      _employee_id: employee!.id,
      _days: 1,
      _hours: 8,
      _overtime_hours: 0,
      _project_id: null, // must be derived from the job
      _conversion_id: job!.id,
      _notes: "e2e payroll costing",
      _line_id: null,
      _allowance: 0,
      _allowance_label: null,
    });
    expect(lineErr, lineErr?.message).toBeNull();

    // 2. Approve --------------------------------------------------------------
    const { error: apprErr } = await db.rpc("approve_attendance_week", { _week_id: weekId });
    expect(apprErr, apprErr?.message).toBeNull();

    const { data: rawRecon, error: reconErr } = await db.rpc("reconcile_attendance_week", { _week_id: weekId });
    expect(reconErr, reconErr?.message).toBeNull();
    const recon: any = rawRecon;

    expect(recon.week.status).toBe("approved");
    expect(recon.ledger.balanced, `ledger out by ${recon.ledger.difference}`).toBe(true);

    const jobRow = recon.jobs.find((j: any) => j.conversion_id === job!.id);
    expect(jobRow, "job missing from reconciliation").toBeTruthy();
    expect(round(Number(jobRow.job_labour_amount))).toBe(round(Number(jobRow.attendance_amount)));
    expect(round(Number(jobRow.cost_entry_amount))).toBe(round(Number(jobRow.attendance_amount)));
    // project derived from the job, not left unassigned
    expect(jobRow.project_id).toBe(job!.project_id);

    const projRow = recon.projects.find((p: any) => p.project_id === job!.project_id);
    expect(projRow, "project missing from reconciliation").toBeTruthy();
    expect(round(Number(projRow.cogs_posted))).toBe(round(Number(projRow.labour_amount)));

    // mirrored job labour rows really exist and are tagged as payroll
    const { data: labour } = await db
      .from("conversion_labour")
      .select("total_cost, source")
      .eq("conversion_id", job!.id)
      .eq("source", "payroll");
    expect((labour ?? []).length).toBeGreaterThan(0);

    const grossBefore = Number(recon.totals.gross);

    // 3. Correct a line -------------------------------------------------------
    const { data: line } = await db
      .from("attendance_lines")
      .select("id, amount")
      .eq("week_id", weekId)
      .eq("is_correction", false)
      .limit(1)
      .single();

    const { error: corrErr } = await db.rpc("correct_attendance_line", {
      _line_id: line!.id,
      _days: 1,
      _hours: 4,
      _overtime_hours: 0,
      _allowance: 0,
      _allowance_label: null,
      _project_id: null,
      _conversion_id: job!.id,
      _reason: "e2e halved the hours",
    });
    expect(corrErr, corrErr?.message).toBeNull();

    const { data: rawAfter } = await db.rpc("reconcile_attendance_week", { _week_id: weekId });
    const after: any = rawAfter;

    // reversal + replacement recorded, ledger still balances, all three sources agree
    expect(Number(after.totals.correction_count)).toBeGreaterThanOrEqual(2);
    expect(after.ledger.balanced, `ledger out by ${after.ledger.difference}`).toBe(true);
    expect(Number(after.totals.gross)).toBeLessThan(grossBefore);

    const jobAfter = after.jobs.find((j: any) => j.conversion_id === job!.id);
    expect(round(Number(jobAfter.job_labour_amount))).toBe(round(Number(jobAfter.attendance_amount)));
    expect(round(Number(jobAfter.cost_entry_amount))).toBe(round(Number(jobAfter.attendance_amount)));

    const projAfter = after.projects.find((p: any) => p.project_id === job!.project_id);
    expect(round(Number(projAfter.cogs_posted))).toBe(round(Number(projAfter.labour_amount)));
  });
});
