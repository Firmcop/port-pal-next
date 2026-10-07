import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export interface PoRecipientPreviewProps {
  containerId?: string | null;
  expectedOwner?: string | null;
  /** Optional label shown before the resolved owner name. Defaults to "PO will be issued to". */
  label?: string;
}

export function sourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "expected_owner":
      return "Expected owner";
    case "sale_original_owner":
    case "sale_acquisition_supplier":
      return "Acquisition vendor";

    case "container_owner":
      return "Container owner";
    default:
      return "Unknown";
  }
}

export function sourceBadgeClass(source: string | null | undefined): string {
  switch (source) {
    case "expected_owner":
      return "bg-info/15 text-info";
    case "sale_original_owner":
    case "sale_acquisition_supplier":
      return "bg-success/15 text-success";

    case "container_owner":
      return "bg-warning/15 text-warning";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/**
 * Shows the recipient the acquisition PO will be issued to BEFORE submit,
 * using the same three-step resolver the server-side RPC uses.
 * Renders a warning when the resolved owner equals the buyer, so operators
 * can catch misrouting (e.g. Container Investment Kenya vs JJ MES DMCC).
 */
export function PoRecipientPreview({
  containerId,
  expectedOwner,
  label = "PO will be issued to",
}: PoRecipientPreviewProps) {
  const enabled = !!containerId;
  const { data, isLoading, error } = useQuery({
    queryKey: ["po-recipient-preview", containerId, expectedOwner ?? null],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "preview_acquisition_recipient" as any,
        {
          _container_id: containerId,
          _expected_owner: expectedOwner ?? null,
        },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row as {
        owner: string | null;
        source: string | null;
        note: string | null;
        buyer_name: string | null;
      } | null;
    },
  });

  if (!enabled) return null;
  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground">Resolving recipient…</div>
    );
  }
  if (error) {
    return (
      <div className="text-xs text-destructive">
        Could not resolve recipient: {(error as Error).message}
      </div>
    );
  }
  if (!data?.owner) return null;

  const buyerMatchesOwner =
    !!data.buyer_name &&
    !!data.owner &&
    data.buyer_name.trim().toLowerCase() === data.owner.trim().toLowerCase();
  const showWarn = data.source === "container_owner" && !!data.buyer_name;

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
      <div className="flex items-center gap-2">
        {showWarn || buyerMatchesOwner ? (
          <AlertTriangle className="h-4 w-4 text-warning" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-success" />
        )}
        <span className="text-muted-foreground">{label}:</span>
        <span className="font-medium">{data.owner}</span>
        <Badge
          variant="secondary"
          className={sourceBadgeClass(data.source)}
        >
          {sourceLabel(data.source)}
        </Badge>
      </div>
      {data.note && (
        <p className="text-xs text-muted-foreground">{data.note}</p>
      )}
      {(showWarn || buyerMatchesOwner) && (
        <p className="text-xs text-warning">
          Warning: the resolved owner looks like the buyer. Confirm the original
          owner before submitting to avoid billing the customer.
        </p>
      )}
    </div>
  );
}
