import { supabase } from "@/integrations/supabase/client";

export type AcquisitionReason = "sale" | "conversion" | "gate_out_sale" | "purchase";

export interface AcquireContainerArgs {
  containerId: string | null | undefined;
  amount: number;
  currency: string;
  reason: AcquisitionReason;
  reference: string;
  /**
   * Optional owner snapshot taken BEFORE any container.owner mutation in the
   * caller's flow. When provided, the RPC uses this value instead of reading
   * containers.owner — which makes the call order-independent and prevents
   * the depot-guard from misfiring after an ownership write.
   */
  expectedOwner?: string | null;
  /** Manually entered rate into the org base currency (null = use the rate table). */
  fxRate?: number | null;
}


/**
 * Post an acquisition Purchase Order payable to the container's owner.
 *
 * Wraps the `acquire_container_from_owner` SECURITY DEFINER RPC. This is the
 * ONLY entry point for that RPC — call sites must not invoke it directly so
 * the no-op guards (missing container, non-positive amount) cannot regress
 * and so we cannot accidentally double-post from a future code path.
 *
 * Returns the new `purchase_orders.id`, or `null` when the call was skipped
 * (missing container, non-positive amount, or owner == depot on the server).
 */
export async function acquireContainerFromOwner(
  args: AcquireContainerArgs,
): Promise<string | null> {
  if (!args.containerId) return null;
  if (!(Number(args.amount) > 0)) return null;

  const { data, error } = await supabase.rpc(
    "acquire_container_from_owner" as any,
    {
      _container_id: args.containerId,
      _amount: Number(args.amount),
      _currency: args.currency || "USD",
      _reason: args.reason,
      _reference: args.reference,
      _expected_owner: args.expectedOwner ?? null,
      _fx_rate: Number(args.fxRate) > 0 ? Number(args.fxRate) : null,
    },

  );
  if (error) throw error;
  return (data as unknown as string) ?? null;
}
