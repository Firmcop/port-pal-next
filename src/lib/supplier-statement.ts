/**
 * Supplier statement reconciliation.
 *
 * A supplier (JJ MES DMCC today) bills containers in bundles: one invoice
 * number covering several containers for one total. This module compares those
 * statement lines with the purchase invoices we actually raised and classifies
 * every line, so the corrections can be applied deliberately rather than
 * guessed at.
 *
 * All matching is pure so the screen, the CSV export and the tests can never
 * disagree about what a line means.
 */

export interface StatementLine {
  /** The supplier's own invoice number, e.g. DD-SE20260612-0134. */
  supplierRef: string;
  /** Total of the whole bundle as billed by the supplier. */
  bundleAmount: number;
  containerNumber: string;
  /** Free text as printed by the supplier (20DV, 40HC…). */
  type: string;
}

export interface OurContainer {
  id: string;
  container_number: string | null;
  size: string | number | null;
  status: string | null;
  owner: string | null;
}

export interface OurInvoice {
  id: string;
  invoice_number: string | null;
  container_id: string | null;
  total_amount: number | string | null;
  currency: string | null;
  status: string | null;
  supplier_ref: string | null;
  reason: string | null;
}

export type LineStatus =
  | "matched"
  | "amount_differs"
  | "no_invoice"
  | "not_in_inventory"
  | "likely_typo"
  | "duplicate";

export interface ClassifiedLine extends StatementLine {
  status: LineStatus;
  /** The container we matched (exact or near). */
  containerId: string | null;
  ourContainerNumber: string | null;
  /** Live (non-cancelled) invoices we raised for that container. */
  invoices: OurInvoice[];
  ourAmount: number;
  note: string;
}

export interface BundleSummary {
  supplierRef: string;
  theirTotal: number;
  ourTotal: number;
  gap: number;
  lines: number;
  /** Lines in this bundle with no container in inventory. */
  missingLines: number;
  /** Amount left over for the missing lines, i.e. theirTotal − ourTotal. */
  residual: number;
}

export const normalizeContainer = (s: string | null | undefined): string =>
  String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export const isLiveInvoice = (i: OurInvoice): boolean =>
  String(i.status ?? "").toLowerCase() !== "cancelled";

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Parse pasted or uploaded statement rows.
 * Accepted per row: supplier invoice number, bundle amount, container number,
 * optional type — comma, semicolon or tab separated. Blank lines are ignored.
 */
export function parseStatement(text: string): StatementLine[] {
  const out: StatementLine[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(/[\t;,]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 3) continue;
    const [ref, amount, container, type] = cells;
    if (!ref || !container) continue;
    if (/^supplier/i.test(ref)) continue; // header row
    const parsed = Number(String(amount).replace(/[^0-9.\-]/g, ""));
    if (!Number.isFinite(parsed)) continue;
    out.push({
      supplierRef: ref,
      bundleAmount: parsed,
      containerNumber: normalizeContainer(container),
      type: type ?? "",
    });
  }
  return out;
}

/** Similarity of two normalized container numbers, 0..1 (longest common subsequence). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n] / Math.max(m, n);
}

/** Best near match for a container number that is not in inventory. */
export function nearMatch(
  target: string,
  candidates: { key: string; container: OurContainer }[],
  minScore = 0.8,
): { container: OurContainer; score: number } | null {
  let best: { container: OurContainer; score: number } | null = null;
  for (const c of candidates) {
    if (Math.abs(c.key.length - target.length) > 3) continue;
    const score = similarity(target, c.key);
    if (score >= minScore && (!best || score > best.score)) best = { container: c.container, score };
  }
  return best;
}

export interface ClassifyInput {
  lines: StatementLine[];
  containers: OurContainer[];
  /** Purchase-price invoices for this supplier only. */
  invoices: OurInvoice[];
}

export function classifyStatement({ lines, containers, invoices }: ClassifyInput): ClassifiedLine[] {
  const byKey = new Map<string, OurContainer>();
  const candidates: { key: string; container: OurContainer }[] = [];
  for (const c of containers) {
    const key = normalizeContainer(c.container_number);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, c);
    candidates.push({ key, container: c });
  }

  const invByContainer = new Map<string, OurInvoice[]>();
  for (const i of invoices) {
    if (!i.container_id || !isLiveInvoice(i)) continue;
    const list = invByContainer.get(i.container_id) ?? [];
    list.push(i);
    invByContainer.set(i.container_id, list);
  }

  // statement lines already matched to a container, keyed to detect duplicates
  return lines.map((l) => {
    const exact = byKey.get(l.containerNumber);
    const base = {
      ...l,
      containerId: null as string | null,
      ourContainerNumber: null as string | null,
      invoices: [] as OurInvoice[],
      ourAmount: 0,
    };

    if (!exact) {
      const near = nearMatch(l.containerNumber, candidates);
      if (near) {
        const inv = invByContainer.get(near.container.id) ?? [];
        return {
          ...base,
          containerId: near.container.id,
          ourContainerNumber: near.container.container_number,
          invoices: inv,
          ourAmount: inv.reduce((s, i) => s + num(i.total_amount), 0),
          status: "likely_typo" as LineStatus,
          note: `Our record reads "${near.container.container_number}" — correct it to the supplier's spelling`,
        };
      }
      return {
        ...base,
        status: "not_in_inventory" as LineStatus,
        note: "Not in inventory — acquired before the system went live, bill as a historical bundle",
      };
    }

    const inv = invByContainer.get(exact.id) ?? [];
    const ourAmount = inv.reduce((s, i) => s + num(i.total_amount), 0);
    const common = {
      ...base,
      containerId: exact.id,
      ourContainerNumber: exact.container_number,
      invoices: inv,
      ourAmount,
    };

    if (!inv.length) {
      return { ...common, status: "no_invoice" as LineStatus, note: "In inventory but no purchase invoice raised" };
    }
    if (inv.length > 1) {
      return {
        ...common,
        status: "duplicate" as LineStatus,
        note: `${inv.length} live purchase invoices: ${inv.map((i) => i.invoice_number).join(", ")}`,
      };
    }
    return {
      ...common,
      status: "matched" as LineStatus,
      note: `Invoiced on ${inv[0].invoice_number}`,
    };
  });
}

/** Their bundle total vs the sum of what we invoiced for the containers in it. */
export function bundleSummaries(rows: ClassifiedLine[]): BundleSummary[] {
  const byRef = new Map<string, BundleSummary>();
  for (const r of rows) {
    let b = byRef.get(r.supplierRef);
    if (!b) {
      b = {
        supplierRef: r.supplierRef,
        theirTotal: r.bundleAmount,
        ourTotal: 0,
        gap: 0,
        lines: 0,
        missingLines: 0,
        residual: 0,
      };
      byRef.set(r.supplierRef, b);
    }
    b.lines += 1;
    b.ourTotal += r.ourAmount;
    if (r.status === "not_in_inventory") b.missingLines += 1;
  }
  for (const b of byRef.values()) {
    b.ourTotal = round2(b.ourTotal);
    b.gap = round2(b.theirTotal - b.ourTotal);
    b.residual = b.gap;
  }
  return Array.from(byRef.values()).sort((a, b) => a.supplierRef.localeCompare(b.supplierRef));
}

export interface BundleDraftLine {
  containerNumber: string;
  amount: number;
}

export interface BundleDraft {
  supplierRef: string;
  residual: number;
  lines: BundleDraftLine[];
  /** True when the bundle can be posted as a historical invoice. */
  postable: boolean;
  blockedReason: string | null;
}

/**
 * Draft historical bundles: one per supplier invoice that still has containers
 * we never received, with the residual (their total minus what we already
 * invoiced) shared evenly across those containers.
 */
export function planHistoricalBundles(rows: ClassifiedLine[]): BundleDraft[] {
  const summaries = new Map(bundleSummaries(rows).map((b) => [b.supplierRef, b]));
  const drafts: BundleDraft[] = [];
  const grouped = new Map<string, ClassifiedLine[]>();
  for (const r of rows) {
    if (r.status !== "not_in_inventory") continue;
    const list = grouped.get(r.supplierRef) ?? [];
    list.push(r);
    grouped.set(r.supplierRef, list);
  }

  for (const [ref, missing] of grouped) {
    const residual = summaries.get(ref)?.residual ?? 0;
    const share = missing.length ? round2(residual / missing.length) : 0;
    const lines = missing.map((m, idx) => ({
      containerNumber: m.containerNumber,
      // put any rounding remainder on the last line
      amount:
        idx === missing.length - 1
          ? round2(residual - share * (missing.length - 1))
          : share,
    }));
    drafts.push({
      supplierRef: ref,
      residual,
      lines,
      postable: residual > 0,
      blockedReason:
        residual > 0
          ? null
          : "The bundle is already fully invoiced on our side — nothing left to bill",
    });
  }

  return drafts.sort((a, b) => a.supplierRef.localeCompare(b.supplierRef));
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export const STATUS_LABEL: Record<LineStatus, string> = {
  matched: "Matched",
  amount_differs: "Amount differs",
  no_invoice: "No invoice raised",
  not_in_inventory: "Not in inventory",
  likely_typo: "Likely typo",
  duplicate: "Duplicate invoice",
};

/**
 * The JJ MES DMCC statement to date, as printed on their bundled invoices.
 * Preloaded so the screen opens on real data; any other statement can be
 * pasted over it.
 */
export const JJ_MES_STATEMENT = `DD-SE20260103-0006,3200,SUDU1467534,20DV
DD-SE20260103-0006,3200,SUDU1432630,20DV
DD-SE20260103-0006,3200,MSKU5056414,20DV
DD-SE20260103-0006,3200,MSKU3302139,20DV
DD-SE20260227-0250,3300,TGHU7741954,40HC
DD-SE20260227-0250,3300,GESU5820352,40HC
DD-SE20260313-0106,1700,MSKU7610839,20DV
DD-SE20260313-0106,1700,MSKU7943824,20DV
DD-SE20260324-0176,1650,YMLU8143948,40HC
DD-SE20260417-0146,1750,TCNU6249249,40HC
DD-SE20260428-0210,1750,EITU1060646,40HC
DD-SE20260519-0160,5400,WSCU7079169,40HC
DD-SE20260519-0160,5400,PCIU2849825,20DV
DD-SE20260519-0160,5400,PCIU1010261,20DV
DD-SE20260519-0160,5400,GESU5945030,40HC
DD-SE20260523-0216,10500,WHLU5591123,40HC
DD-SE20260523-0216,10500,TGHU8339174,40HC
DD-SE20260523-0216,10500,PRGU9515610,40HC
DD-SE20260523-0216,10500,MMAU4017449,40HC
DD-SE20260523-0216,10500,KKFU7529099,40HC
DD-SE20260523-0216,10500,CBHU8130574,40HC
DD-SE20260529-0263,5600,WEDU6286189,20DV
DD-SE20260529-0263,5600,WEDU3285907,20DV
DD-SE20260529-0263,5600,TRKU2039974,20DV
DD-SE20260529-0263,5600,TRKU2039887,20DV
DD-SE20260529-0263,5600,TRKU2039763,20DV
DD-SE20260529-0263,5600,TRKU2039125,20DV
DD-SE20260529-0263,5600,TRKU2035259,20DV
DD-SE20260529-0263,5600,TRKU2030787,20DV
DD-SE20260612-0134,13600,TGHU8507025,40HC
DD-SE20260612-0134,13600,TGHU6447457,40HC
DD-SE20260612-0134,13600,TDRU4139486,40HC
DD-SE20260612-0134,13600,TCNU9461884,40HC
DD-SE20260612-0134,13600,TCNU7294319,40HC
DD-SE20260612-0134,13600,GATU8475655,40HC
DD-SE20260612-0134,13600,FCIU8353600,40HC
DD-SE20260612-0134,13600,AMFU8671919,40HC
DD-SE20260618-0180,2350,LMCU7000753,40DV
DD-SE20260620-0192,6500,WEDU3928388,20DV
DD-SE20260620-0192,6500,WEDU3064470,20DV
DD-SE20260620-0192,6500,WEDU1005186,20DV
DD-SE20260620-0192,6500,TCKU3172576,20DV
DD-SE20260620-0192,6500,FCIU3433093,20DV
DD-SE20260620-0192,6500,BMOU2665075,20DV
DD-SE20260620-0192,6500,AMFU8781789,40HC
DD-SE20260703-0022,10200,TDTU0628085,40HC
DD-SE20260703-0022,10200,SVWU7592549,40HC
DD-SE20260703-0022,10200,MOTU0773577,40HC
DD-SE20260703-0022,10200,MOTU0722414,40HC
DD-SE20260703-0022,10200,CRSU9357335,40HC
DD-SE20260703-0022,10200,AXIU1503496,40HC
DD-SE20260707-0065,1400,WEDU6586606,20DV
DD-SE20260707-0065,1400,WEDU3446513,20DV
DD-SE20260710-0119,4200,WEDU3846736,20DV
DD-SE20260710-0119,4200,WEDU3146096,20DV
DD-SE20260710-0119,4200,GESU3190151,20DV
DD-SE20260710-0119,4200,CARU2788538,20DV
DD-SE20260710-0119,4200,CAIU2689652,20DV
DD-SE20260710-0119,4200,BMOU2021982,20DV
DD-SE20260715-0150,2800,WEDU3042065,20DV
DD-SE20260715-0150,2800,WEDU2463877,20DV
DD-SE20260715-0150,2800,LCRU0145012,20DV
DD-SE20260715-0150,2800,BMOU2136636,20DV
DD-SE20260716-0161,3400,TCNU9465154,40HC
DD-SE20260716-0161,3400,FSCU6765059,40HC
DD-SE20260729-0276,2800,WSCU3403074,20DV
DD-SE20260729-0276,2800,WEDU3561590,20DV
DD-SE20260729-0276,2800,WEDU1105098,20DV
DD-SE20260729-0276,2800,GLDU3557937,20DV
DD-SE20260803-0010,1700,BSIU9512936,40HC
DD-SE20260803-0012,2800,WEDU3561055,20DV
DD-SE20260803-0012,2800,WEDU3192851,20DV
DD-SE20260803-0012,2800,TCKU3839695,20DV
DD-SE20260803-0012,2800,CSLU1175840,20DV
DD-SE20260804-0015,5100,BSIU9500128,20DV
DD-SE20260804-0015,5100,BSIU9373300,20DV
DD-SE20260804-0015,5100,BSIU9315346,20DV
DD-SE20260813-0153,6800,XINU8230422,40HC
DD-SE20260813-0153,6800,TTNU9772976,40HC
DD-SE20260813-0153,6800,TCNU9140396,40HC
DD-SE20260813-0153,6800,FSCU9939200,40HC
DD-SE20260818-0185,700,KKTU7470816,20DV
DD-SE20260819-0199,4950,ZCSU8954242,40HC
DD-SE20260819-0199,4950,ZCSU7039262,40HC
DD-SE20260819-0199,4950,CRSU9063808,40HC
DD-SE20260821-0226,6850,TRLU7496991,40HC
DD-SE20260821-0226,6850,TCNU9737627,40HC
DD-SE20260821-0226,6850,SKHU8407634,40HC
DD-SE20260821-0226,6850,CLHU8982502,40HC`;
