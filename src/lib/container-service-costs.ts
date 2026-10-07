import { supabase } from "@/integrations/supabase/client";

export type ServiceKind = "transport" | "crane_offloading";

export interface RecordServiceInvoiceArgs {
  containerId: string | null | undefined;
  vendorName: string | null | undefined;
  amount: number | null | undefined;
  currency: string;
  serviceKind: ServiceKind;
  reference?: string | null;
  /** Manually entered rate into the org base currency (null = use the rate table). */
  fxRate?: number | null;
}


/**
 * Raise a purchase invoice (PINV) payable to a container acquisition service
 * vendor — the transporter that delivered the box, or the crane / offloading
 * contractor. Together with the seller's acquisition invoice these make up the
 * total acquisition cost of a container.
 *
 * Wraps the `record_container_service_invoice` SECURITY DEFINER RPC. This is
 * the ONLY entry point for that RPC so the guards (missing container, blank
 * vendor, non-positive amount) and the server-side idempotency check cannot be
 * bypassed by a future call site.
 *
 * Returns the new `purchase_orders.id`, or `null` when the call was skipped
 * (missing data, or an invoice for that container + service already exists).
 */
export async function recordContainerServiceInvoice(
  args: RecordServiceInvoiceArgs,
): Promise<string | null> {
  if (!args.containerId) return null;
  if (!args.vendorName || !args.vendorName.trim()) return null;
  if (!(Number(args.amount) > 0)) return null;

  const { data, error } = await supabase.rpc(
    "record_container_service_invoice" as any,
    {
      _container_id: args.containerId,
      _vendor_name: args.vendorName.trim(),
      _amount: Number(args.amount),
      _currency: (args.currency || "USD").toUpperCase(),
      _service_kind: args.serviceKind,
      _reference: args.reference ?? null,
      _fx_rate: Number(args.fxRate) > 0 ? Number(args.fxRate) : null,
    },

  );
  if (error) throw error;
  return (data as unknown as string) ?? null;
}
