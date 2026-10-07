# Allow container purchase prices that differ from the standard rate

## What's happening now

Two separate rules are blocking you:

1. The system treats USD 1,700 (40ft) and USD 700 (20ft) from JJ MES DMCC as fixed prices. Anything different is rejected unless a "supplier discount" flag and note are set — and there is no place in the screen to set them.
2. The error you saw ("violates check constraint supplier_invoices_reason_check") is a separate bug: when you change a container's purchase cost, the system files the new invoice under a reason label that the database was never told to accept. So even a correctly priced edit fails.

## What will change

- The standard price becomes a reference, not a rule. Any positive purchase price is accepted; the reason you already have to type when editing costs is saved as the price justification, and the invoice is marked as off-standard when it differs.
- Off-standard prices stay visible: the container's acquisition history and the invoice reconciliation screen will show expected vs actual price and the reason, so nothing is silently mispriced.
- Zero or negative purchase prices stay blocked, as do duplicate purchase invoices for the same container and invoices against split-child containers — those guards are unchanged.
- The reason-label bug is fixed so cost edits save.
- Currency for this supplier stays enforced as USD.

## Technical notes

- Migration 1: add `acquisition_cost_edit` to the `supplier_invoices_reason_check` allowed values (it is already handled everywhere else in code and in `validate_container_acquisition_invoice`).
- Migration 2: rewrite `validate_container_acquisition_invoice` so the JJ MES DMCC size-based price block becomes classification instead of rejection — set `pricing_basis` to `standard` when the amount matches the reference, otherwise `supplier_discount` (below) or `price_variance` (above), and keep `pricing_note` when supplied. Retain: positive-amount check, split-child block, duplicate purchase-price block, USD currency check.
- `set_container_acquisition_costs` passes its mandatory `_reason` through to `acquire_container_from_owner` so it lands in `pricing_note` on the created invoice.
- `container_invoice_reconciliation` already computes the expected price per size; surface the variance rows as an informational flag rather than an error.
- No frontend changes required; the existing edit dialog and audit panel already display reason and amounts.

## Verification

Re-run the cost edit on the container you were working on with the lower price and confirm the invoice saves, shows the reduced amount, and appears in the acquisition history with your reason.
