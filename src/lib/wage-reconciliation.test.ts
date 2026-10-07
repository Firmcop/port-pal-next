import { describe, it, expect } from "vitest";
import {
  normalizeReconciliation,
  jobIsReconciled,
  projectIsReconciled,
  reconciliationIssues,
} from "@/lib/wage-reconciliation";

const base = {
  week: { id: "w1", week_start: "2026-08-17", week_end: "2026-08-23", status: "approved", currency: "KES", paid_at: null },
  totals: { base: "60000", overtime: "1835.2", allowance: "5000", gross: "66835.2", deductions: "2000", net: "64835.2", line_count: 48, correction_count: 0 },
  jobs: [{ conversion_id: "c1", job_number: "CNV-1", project_id: "p1", project_name: "Peter", attendance_amount: "1000", job_labour_amount: "1000", cost_entry_amount: "1000", variance: "0" }],
  projects: [{ project_id: "p1", project_name: "Peter", labour_amount: "950", allowance_amount: "50", cogs_posted: "950", variance: "0" }],
  accounts: [{ account_type: "cost_of_goods", category: "project_labour", debit: "950", credit: "0", entries: 1 }],
  ledger: { debit: "66835.2", credit: "66835.2", difference: "0", balanced: true },
};

describe("wage reconciliation", () => {
  it("coerces every numeric field", () => {
    const r = normalizeReconciliation(base);
    expect(r.totals.gross).toBe(66835.2);
    expect(r.jobs[0].attendance_amount).toBe(1000);
    expect(r.ledger.balanced).toBe(true);
  });

  it("tolerates a missing payload", () => {
    const r = normalizeReconciliation(undefined);
    expect(r.jobs).toEqual([]);
    expect(r.totals.gross).toBe(0);
  });

  it("flags a job whose mirrored labour does not match attendance", () => {
    const r = normalizeReconciliation({ ...base, jobs: [{ ...base.jobs[0], job_labour_amount: "800" }] });
    expect(jobIsReconciled(r.jobs[0], "KES")).toBe(false);
    expect(reconciliationIssues(r)).toContain("1 job(s) with a labour variance");
  });

  it("flags a project whose COGS posting does not match labour", () => {
    const r = normalizeReconciliation({ ...base, projects: [{ ...base.projects[0], cogs_posted: "0" }] });
    expect(projectIsReconciled(r.projects[0], "KES")).toBe(false);
  });

  it("nets corrections out so a reversed-and-replaced line still reconciles", () => {
    // original 1000 reversed (-1000) and replaced with 1200 → attendance 1200
    const r = normalizeReconciliation({
      ...base,
      totals: { ...base.totals, correction_count: 2 },
      jobs: [{ ...base.jobs[0], attendance_amount: "1200", job_labour_amount: "1200", cost_entry_amount: "1200" }],
      projects: [{ ...base.projects[0], labour_amount: "1150", cogs_posted: "1150" }],
    });
    expect(reconciliationIssues(r)).toEqual([]);
  });

  it("reports an unbalanced ledger", () => {
    const r = normalizeReconciliation({ ...base, ledger: { debit: "100", credit: "90", difference: "10", balanced: false } });
    expect(reconciliationIssues(r)[0]).toMatch(/out of balance by 10/);
  });
});
