/**
 * Reference ("EIR") purchase rates per container size.
 *
 * These are the usual rates a container of each size is bought at. They are a
 * benchmark only — nothing is enforced against them. A container bought below
 * or above the reference simply shows as a variance on the job rate table,
 * the EIR and the supplier pricing dashboard.
 *
 * Mirrors the database function public.container_reference_rate(text).
 */

export const REFERENCE_RATE_CURRENCY = "USD";

export const REFERENCE_RATES: Record<string, number> = {
  "20": 700,
  "40": 1700,
  "45": 1700,
};

/** Normalise "40HC", 40, "40ft" → "40". */
export function normalizeSize(size: string | number | null | undefined): string {
  return String(size ?? "").replace(/\D/g, "");
}

/** Reference rate in USD for a container size, or null when there is no benchmark. */
export function referenceRate(size: string | number | null | undefined): number | null {
  const key = normalizeSize(size);
  return key in REFERENCE_RATES ? REFERENCE_RATES[key] : null;
}

export interface RateVariance {
  reference: number | null;
  variance: number | null;
  variancePct: number | null;
  /** "discount" when bought below the reference, "over" when above. */
  kind: "discount" | "over" | "at_rate" | null;
}

/** Compare an actual price against the reference rate for that size. */
export function rateVariance(actual: number | null | undefined, size: string | number | null | undefined): RateVariance {
  const reference = referenceRate(size);
  const a = Number(actual ?? 0);
  if (reference == null || !Number.isFinite(a)) return { reference, variance: null, variancePct: null, kind: null };
  const variance = Math.round((a - reference) * 100) / 100;
  const variancePct = reference ? Math.round((variance / reference) * 1000) / 10 : null;
  const kind = Math.abs(variance) < 0.01 ? "at_rate" : variance < 0 ? "discount" : "over";
  return { reference, variance, variancePct, kind };
}

export function varianceLabel(kind: RateVariance["kind"]) {
  if (kind === "discount") return "discount";
  if (kind === "over") return "over rate";
  if (kind === "at_rate") return "at rate";
  return "";
}
