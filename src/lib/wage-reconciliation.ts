import { roundMoney } from "@/lib/money";

export type WageJobRow = {
  conversion_id: string;
  job_number: string | null;
  project_id: string | null;
  project_name: string | null;
  attendance_amount: number;
  job_labour_amount: number;
  cost_entry_amount: number;
  variance: number;
};

export type WageProjectRow = {
  project_id: string | null;
  project_name: string;
  labour_amount: number;
  allowance_amount: number;
  cogs_posted: number;
  variance: number;
};

export type WageAccountRow = {
  account_type: string;
  category: string | null;
  debit: number;
  credit: number;
  entries: number;
};

export type WageReconciliation = {
  week: {
    id: string;
    week_start: string;
    week_end: string;
    status: string;
    currency: string;
    paid_at: string | null;
  };
  totals: {
    base: number;
    overtime: number;
    allowance: number;
    gross: number;
    deductions: number;
    net: number;
    line_count: number;
    correction_count: number;
  };
  jobs: WageJobRow[];
  projects: WageProjectRow[];
  accounts: WageAccountRow[];
  ledger: { debit: number; credit: number; difference: number; balanced: boolean };
};

const n = (v: unknown) => Number(v ?? 0);

/** Normalise the RPC payload into numbers we can safely render and compare. */
export function normalizeReconciliation(raw: any): WageReconciliation {
  return {
    week: raw?.week ?? { id: "", week_start: "", week_end: "", status: "draft", currency: "USD", paid_at: null },
    totals: {
      base: n(raw?.totals?.base),
      overtime: n(raw?.totals?.overtime),
      allowance: n(raw?.totals?.allowance),
      gross: n(raw?.totals?.gross),
      deductions: n(raw?.totals?.deductions),
      net: n(raw?.totals?.net),
      line_count: n(raw?.totals?.line_count),
      correction_count: n(raw?.totals?.correction_count),
    },
    jobs: (raw?.jobs ?? []).map((j: any) => ({
      conversion_id: j.conversion_id,
      job_number: j.job_number ?? null,
      project_id: j.project_id ?? null,
      project_name: j.project_name ?? null,
      attendance_amount: n(j.attendance_amount),
      job_labour_amount: n(j.job_labour_amount),
      cost_entry_amount: n(j.cost_entry_amount),
      variance: n(j.variance),
    })),
    projects: (raw?.projects ?? []).map((p: any) => ({
      project_id: p.project_id ?? null,
      project_name: p.project_name ?? "Unassigned",
      labour_amount: n(p.labour_amount),
      allowance_amount: n(p.allowance_amount),
      cogs_posted: n(p.cogs_posted),
      variance: n(p.variance),
    })),
    accounts: (raw?.accounts ?? []).map((a: any) => ({
      account_type: a.account_type,
      category: a.category ?? null,
      debit: n(a.debit),
      credit: n(a.credit),
      entries: n(a.entries),
    })),
    ledger: {
      debit: n(raw?.ledger?.debit),
      credit: n(raw?.ledger?.credit),
      difference: n(raw?.ledger?.difference),
      balanced: Boolean(raw?.ledger?.balanced),
    },
  };
}

/** True when the three sources of truth agree for a job (within currency precision). */
export function jobIsReconciled(row: WageJobRow, currency?: string | null): boolean {
  const a = roundMoney(row.attendance_amount, currency);
  return roundMoney(row.job_labour_amount, currency) === a && roundMoney(row.cost_entry_amount, currency) === a;
}

export function projectIsReconciled(row: WageProjectRow, currency?: string | null): boolean {
  return roundMoney(row.labour_amount, currency) === roundMoney(row.cogs_posted, currency);
}

/** Aggregate mismatch count used for the page-level status banner. */
export function reconciliationIssues(r: WageReconciliation): string[] {
  const issues: string[] = [];
  const c = r.week.currency;
  const badJobs = r.jobs.filter((j) => !jobIsReconciled(j, c));
  const badProjects = r.projects.filter((p) => !projectIsReconciled(p, c));
  if (!r.ledger.balanced) issues.push(`Ledger out of balance by ${r.ledger.difference}`);
  if (badJobs.length) issues.push(`${badJobs.length} job(s) with a labour variance`);
  if (badProjects.length) issues.push(`${badProjects.length} project(s) with a COGS variance`);
  return issues;
}
