/**
 * Where to open a document from an approval request or a notification.
 * Keep in step with the routes under src/app/(app) — the old react-router
 * paths (/purchase-orders, /finance/vendor-payments, /eir, …) no longer exist.
 */
export const DOC_LINKS: Record<string, (id?: string | null) => string> = {
  quote: (id) => (id ? `/quotes/${id}` : "/quotes"),
  purchase_order: (id) => (id ? `/procurement?open=${id}` : "/procurement"),
  payment: (id) => (id ? `/billing/payments?tab=customer&open=${id}` : "/billing/payments?tab=customer"),
  vendor_payment: (id) => (id ? `/billing/payments?tab=vendor&open=${id}` : "/billing/payments?tab=vendor"),
  payment_allocation: () => "/billing/payments?tab=customer",
  contra_settlement: () => "/finance/contra-settlements",
  repatriation: (id) => (id ? `/repatriation?highlight=${id}` : "/repatriation"),
  eir: (id) => (id ? `/gate/eir?open=${id}` : "/gate/eir"),
  goods_receipt_variance: () => "/finance/approvals",
  operating_expense: () => "/finance/operating-expenses",
  // non-approval notifications
  container_conversions: (id) => (id ? `/conversions/${id}` : "/conversions"),
  conversion: (id) => (id ? `/conversions/${id}` : "/conversions"),
  container_movements: () => "/movements",
  gate_appointments: () => "/gate/appointments",
  work_orders: () => "/mr/work-orders",
  containers: (id) => (id ? `/inventory/${id}` : "/inventory"),
};

export function docLink(docType: string | null | undefined, id?: string | null): string | null {
  if (!docType) return null;
  const f = DOC_LINKS[docType];
  return f ? f(id) : null;
}
