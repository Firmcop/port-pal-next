import { Link } from "@/lib/router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useContainerAcquisition } from "@/hooks/use-container-acquisition";

/**
 * Read-only cost pair used by the sale and conversion forms. The values are
 * always fetched from the container's live acquisition invoices, so they can
 * only be changed on the container itself.
 */
export default function AcquisitionCostFields({
  containerId,
  containerNumber,
  purchaseLabel = "Purchase Price (to owner)",
}: {
  containerId?: string | null;
  containerNumber?: string | null;
  purchaseLabel?: string;
}) {
  const { data, isLoading } = useContainerAcquisition(containerId, containerNumber);


  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });
  const list = (rows?: { currency: string; amount: number }[], fallback?: number) =>
    rows && rows.length > 1
      ? rows.map((r) => `${r.currency} ${fmt(r.amount)}`).join(" · ")
      : rows && rows.length === 1
        ? `${rows[0].currency} ${fmt(rows[0].amount)}`
        : fmt(fallback ?? 0);

  const fxHint =
    data && data.purchaseSourceAmount != null
      ? `${data.purchaseCurrency} ${fmt(data.purchaseSourceAmount)}${
          data.purchaseFxRate ? ` @ ${data.purchaseFxRate.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : ""
        } → ${data.currency} ${fmt(data.purchase)}`
      : null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>{purchaseLabel}</Label>
          <Input readOnly className="bg-muted" value={data ? `${data.currency} ${fmt(data.purchase)}` : isLoading ? "…" : "0.00"} />
          {fxHint && <p className="text-xs text-muted-foreground">{fxHint}</p>}
        </div>
        <div className="space-y-2">
          <Label>Transport &amp; Offloading</Label>
          <Input readOnly className="bg-muted" value={data ? `${data.currency} ${fmt(data.services)}` : isLoading ? "…" : "0.00"} />
          {data && data.servicesByCurrency.length > 1 && (
            <p className="text-xs text-muted-foreground">{list(data.servicesByCurrency)}</p>
          )}
        </div>
      </div>
      {containerId && (
        <p className="text-xs text-muted-foreground">
          {data?.empty
            ? "No acquisition cost recorded for this container. "
            : `Fetched from the container's purchase invoices — total ${data?.currency} ${fmt(data?.total ?? 0)}${
                data?.unconverted?.length
                  ? ` (no exchange rate for ${data.unconverted.map((u) => u.invoice_number).join(", ")} — shown unconverted)`
                  : ""
              }. `}
          <Link to={`/inventory/${containerId}`} className="underline hover:no-underline">
            Edit on the container
          </Link>
        </p>
      )}
    </div>
  );

}
