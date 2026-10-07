import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type InvoiceLike = {
  status?: string | null;
  total_amount?: number | string | null;
  partially_paid?: boolean | null;
} | null | undefined;

export type DerivedState =
  | "not_issued"
  | "pending_approval"
  | "disputed"
  | "issued"
  | "partial"
  | "paid"
  | "overdue"
  | "cancelled";

export function deriveInvoiceState(
  invoice: InvoiceLike,
  paidAmount: number = 0,
  opts?: { depositStatus?: string | null; kind?: "deposit" | "balance" | "other" },
): DerivedState {
  const kind = opts?.kind ?? "other";
  const depositStatus = opts?.depositStatus ?? null;

  if (kind === "deposit" && depositStatus === "pending_approval") return "pending_approval";
  if (kind === "deposit" && depositStatus === "disputed") return "disputed";

  if (!invoice) return "not_issued";

  const total = Number(invoice.total_amount ?? 0);
  const status = (invoice.status ?? "").toLowerCase();

  if (status === "cancelled" || status === "credited") return "cancelled";
  if (status === "paid" || (total > 0 && paidAmount >= total)) return "paid";
  if (status === "overdue") return "overdue";
  if (paidAmount > 0 || invoice.partially_paid) return "partial";
  return "issued";
}

const STATE_META: Record<DerivedState, { label: string; className: string }> = {
  not_issued: { label: "Not issued", className: "bg-muted text-muted-foreground border-transparent" },
  pending_approval: { label: "Pending approval", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-transparent" },
  disputed: { label: "Disputed", className: "bg-destructive/15 text-destructive border-transparent" },
  issued: { label: "Issued", className: "bg-info/15 text-info border-transparent" },
  partial: { label: "Partially collected", className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-transparent" },
  paid: { label: "Paid", className: "bg-success/15 text-success border-transparent" },
  overdue: { label: "Overdue", className: "bg-destructive/15 text-destructive border-transparent" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground border-transparent line-through" },
};

interface Props {
  invoice: InvoiceLike;
  paidAmount?: number;
  depositStatus?: string | null;
  kind?: "deposit" | "balance" | "other";
  className?: string;
}

export function InvoiceStatusBadge({ invoice, paidAmount = 0, depositStatus, kind, className }: Props) {
  const state = deriveInvoiceState(invoice, paidAmount, { depositStatus, kind });
  const meta = STATE_META[state];
  return <Badge className={cn(meta.className, className)}>{meta.label}</Badge>;
}
