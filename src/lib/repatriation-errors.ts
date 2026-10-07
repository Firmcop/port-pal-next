// Maps Postgres errors raised by the repatriation/release-instruction trigger
// and RPCs into user-facing messages.
export function mapRepatriationError(err: unknown): string {
  const raw = (err as any)?.message ?? String(err ?? "");
  if (!raw) return "Unknown error";

  const locked = raw.match(/release_order_locked_to_instruction:(\S+)/);
  if (locked) {
    return `This RO number is locked to release instruction ${locked[1]}. Use "Unlink Release Instruction" to override with a manual RO and a recorded reason.`;
  }
  if (raw.includes("release_instruction_container_mismatch")) {
    return "The selected release instruction is for a different container. Pick an instruction issued for this container.";
  }
  if (raw.includes("release_instruction_org_mismatch")) {
    return "The selected release instruction belongs to a different organization.";
  }
  if (raw.includes("release_instruction_not_found")) {
    return "The linked release instruction no longer exists. Refresh and try again.";
  }
  if (raw.includes("not_linked")) {
    return "This repatriation is not linked to a release instruction.";
  }
  if (raw.includes("reason_required")) {
    return "Please provide a reason of at least 3 characters.";
  }
  if (raw.includes("new_release_order_no_required")) {
    return "A new RO number is required.";
  }
  if (raw.includes("repatriation_owner_missing")) {
    return "Set the container owner before completing repatriation — the invoice needs a bill-to party.";
  }
  if (raw.includes("repatriation_already_invoiced")) {
    return "This repatriation has already been invoiced to the owner.";
  }
  if (raw.includes("repatriation_nothing_to_bill")) {
    return "No billable charges (gate-in, storage, handling, and repat fee are all zero). Set a tariff or a repat fee first.";
  }
  if (raw.includes("repatriation_no_container")) {
    return "This repatriation has no linked container to bill.";
  }
  if (raw.includes("repatriation_invoice_missing")) {
    return "This repatriation has no invoice yet. Complete it first to generate one.";
  }
  if (raw.includes("repatriation_invoice_already_settled")) {
    return "This invoice is already fully paid.";
  }

  // record_customer_payment / mark-as-paid errors
  if (raw.includes("payment_exceeds_balance")) {
    return "Payment amount exceeds the outstanding balance.";
  }
  if (raw.includes("invoice_already_paid")) {
    return "This invoice is already fully paid.";
  }
  if (raw.includes("financial_account_currency_mismatch")) {
    return "The selected account's currency doesn't match the invoice currency.";
  }
  if (raw.includes("invalid_financial_account")) {
    return "The selected account isn't available for this record — it belongs to a different organization or is inactive. Pick an active account from your company's finance settings.";
  }
  if (raw.includes("financial_account_required")) {
    return "Select a receiving account before recording the payment.";
  }

  if (raw.includes("invalid_amount")) {
    return "Enter a valid payment amount greater than zero.";
  }
  if (raw.includes("invoice_voided")) {
    return "This invoice has been voided or credited and cannot be paid.";
  }
  if (raw.includes("invoice_not_found")) {
    return "Invoice not found. Refresh and try again.";
  }
  if (raw.includes("no_active_organization")) {
    return "No active organization selected.";
  }

  if (raw.includes("forbidden_role") || raw.includes("forbidden_org")) {
    return "You don't have permission to perform this action.";
  }
  return raw;
}

