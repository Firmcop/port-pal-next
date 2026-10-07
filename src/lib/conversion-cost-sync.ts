import { supabase } from "@/integrations/supabase/client";

/**
 * Conversion jobs store a snapshot of each attached container's acquisition
 * cost. When an acquisition invoice is later corrected (supplier, amount,
 * currency, transport backfill…) the snapshot drifts. These helpers expose the
 * live figures and let admins re-sync a job.
 */

export type ResyncPreviewRow = {
  link_id: string;
  conversion_id: string;
  conversion_number: string | null;
  job_status: string;
  container_id: string;
  container_number: string | null;
  currency: string;
  stored_purchase: number;
  stored_transport: number;
  live_purchase: number | null;
  live_transport: number | null;
  delta: number | null;
  error: string | null;
};

const DRIFT_EPSILON = 0.01;

export function isDrifted(row: Pick<ResyncPreviewRow, "delta" | "stored_purchase" | "stored_transport" | "live_purchase" | "live_transport">) {
  if (row.live_purchase == null || row.live_transport == null) return false;
  return (
    Math.abs(Number(row.delta ?? 0)) > DRIFT_EPSILON ||
    Math.abs(Number(row.live_purchase) - Number(row.stored_purchase || 0)) > DRIFT_EPSILON ||
    Math.abs(Number(row.live_transport) - Number(row.stored_transport || 0)) > DRIFT_EPSILON
  );
}

/** Stored vs live acquisition cost for every container on one job (or all jobs). */
export async function previewConversionResync(conversionId?: string | null): Promise<ResyncPreviewRow[]> {
  const { data, error } = await (supabase as any).rpc("preview_conversion_container_resync", {
    _conversion_id: conversionId ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    stored_purchase: Number(r.stored_purchase || 0),
    stored_transport: Number(r.stored_transport || 0),
    live_purchase: r.live_purchase == null ? null : Number(r.live_purchase),
    live_transport: r.live_transport == null ? null : Number(r.live_transport),
    delta: r.delta == null ? null : Number(r.delta),
  })) as ResyncPreviewRow[];
}

export type ResyncResult = { updated: number; delta_total: number; ledger_posted: boolean };

/** Re-sync one container (or all containers when containerId is omitted) on a job. */
export async function resyncConversionContainerCosts(opts: {
  conversionId: string;
  reason: string;
  containerId?: string | null;
}): Promise<ResyncResult> {
  const { data, error } = await (supabase as any).rpc("resync_conversion_container_costs", {
    _conversion_id: opts.conversionId,
    _reason: opts.reason,
    _container_id: opts.containerId ?? null,
  });
  if (error) throw new Error(friendlyResyncError(error.message));
  return data as ResyncResult;
}

export function friendlyResyncError(msg: string) {
  const m = String(msg || "");
  if (m.includes("not_authorized")) return "Only admins can re-sync container costs on a job.";
  if (m.includes("reason_required")) return "Please give a reason for the re-sync.";
  if (m.includes("conversion_cancelled")) return "This job is cancelled — costs can't be re-synced.";
  if (m.includes("conversion_not_found")) return "Conversion job not found.";
  if (m.includes("missing_fx_rate")) return m.replace(/^.*missing_fx_rate:\s*/, "");
  return m;
}

export type SplitRestateResult = { children: number; total_cost: number; per_child: number };

/**
 * Restate the equal cost shares of a completed split job so every child unit
 * carries its portion of the mother container's full acquisition cost
 * (purchase plus transport & crane) together with the job's own costs.
 */
export async function recomputeSplitOutputCosts(conversionId: string, reason: string): Promise<SplitRestateResult> {
  const { data, error } = await (supabase as any).rpc("recompute_split_output_costs", {
    _conversion_id: conversionId,
    _reason: reason,
  });
  if (error) throw new Error(friendlySplitRestateError(error.message));
  return data as SplitRestateResult;
}

export function friendlySplitRestateError(msg: string) {
  const m = String(msg || "");
  if (m.includes("not_authorized")) return "Only admins can restate the split cost shares.";
  if (m.includes("reason_required")) return "Please give a reason for the restatement.";
  if (m.includes("no_child_containers")) return "This job has no child containers yet.";
  if (m.includes("not_a_split_job")) return "Cost shares can only be restated on split jobs.";
  return m;
}
