import { Badge } from "@/components/ui/badge";

type Props = {
  invoice?: { status?: string | null; total_amount?: number | null } | null;
  paidTotal?: number;
};

/** Derives an end-to-end settlement state from the repatriation's owner invoice. */
export function RepatriationSettlementBadge({ invoice, paidTotal = 0 }: Props) {
  if (!invoice) {
    return <Badge variant="outline" className="bg-muted text-muted-foreground">Unbilled</Badge>;
  }
  const total = Number(invoice.total_amount ?? 0);
  const outstanding = Math.max(0, total - Number(paidTotal ?? 0));
  const status = invoice.status ?? "draft";

  if (status === "void" || status === "cancelled") {
    return <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30">Void</Badge>;
  }
  if (outstanding <= 0 && total > 0) {
    return <Badge variant="outline" className="bg-success/15 text-success border-success/30">Paid</Badge>;
  }
  if (paidTotal > 0 && outstanding > 0) {
    return <Badge variant="outline" className="bg-info/15 text-info border-info/30">Partially paid</Badge>;
  }
  if (status === "sent") {
    return <Badge variant="outline" className="bg-info/15 text-info border-info/30">Sent</Badge>;
  }
  return <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">Draft</Badge>;
}
