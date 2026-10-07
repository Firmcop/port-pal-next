# Repatriation transfer fee + itemised handling invoice

## Verified current state

- `repat_rate_cards` holds exactly one row: Nairobi -> Multiple Kampala, 40ft, USD 550 rate + USD 30 handling, effective 24 Aug 2026. There is no Mombasa -> Nairobi leg and no transfer-fee field.
- The handling invoice `RPH-20260825-JJMES` (USD 570) **does** have 19 line items in the database, but **zero** linked containers.
- The printed PDF shows a single "handling charge — $570.00" line because the invoice list query in `src/pages/Invoices.tsx` does not select `invoice_line_items`, so `printInvoice` falls back to its summary line. The template already renders per-line rows when they are supplied.

## 1. Mombasa -> Nairobi transfer fee (USD 320, editable)

- Add a `transfer_fee` amount to rate cards so each route/size can carry a pre-leg transfer charge with effective-from/to dates; historical repatriations keep the rate applied at execution time.
- Seed a Mombasa -> Nairobi card at USD 320 (all sizes) for JJ MES DMCC, editable from the existing Rate Cards screen (amount, currency, effective dates, active flag).
- Store a snapshot on each repatriation (`transfer_fee_applied`, currency, applied-at, source rate card) when the rate is applied, so later rate changes never restate past billing.
- New batch billing action "Generate transfer invoice": one **separate** owner invoice (prefix `RPT-`), one line per container at the snapshot rate, idempotent so a repatriation already on an active transfer invoice cannot be billed twice.
- Backfill: generate the transfer invoice for all 19 existing JJ MES DMCC repatriations at USD 320 each (**USD 6,080**), with a preview of eligible/excluded units before creation.
- Reconciliation checks extended: flag repatriations missing a transfer line, duplicated transfer lines, or a transfer fee mixed into transport/handling invoices.

## 2. Container details on handling (and transfer) invoices

- Link every handling/transfer invoice line to its container via `invoice_containers` so the invoice header lists all container numbers, and backfill this for the existing USD 570 invoice.
- Ensure each line description reads `<container no> — <repatriation no> — handling` (same pattern for transfer).
- Fix the print/export path so line items are always included: the invoice query selects `invoice_line_items` and `printInvoice` receives them, producing a per-container table (19 rows at USD 30) instead of one lump line. Same fix applies to the CSV/PDF export.

## 3. UI

- Repatriation list/detail: three separate billing badges — Transport, Handling, Transfer — each with its invoice reference and status.
- Rate Cards screen: transfer-fee column and editing, with validity dates shown.
- Batch dialog mirrors the handling dialog: eligible units, exclusions with reasons, line count, and USD total before generating.

## Technical notes

- Migration: `transfer_fee` on `repat_rate_cards`; transfer snapshot + `transfer_invoice_id` on `repatriations`; `repatriation_transfer_invoice_lines` link table with grants and RLS; `preview_repatriation_transfer_invoice` / `generate_repatriation_transfer_invoice` RPCs (SECURITY DEFINER, execute revoked from public, granted to authenticated).
- Data operations: seed the Mombasa -> Nairobi USD 320 card, create the USD 6,080 backfill transfer invoice, and add `invoice_containers` rows for the existing handling invoice.
- Frontend: `src/pages/Invoices.tsx` (select line items, pass to print/export), `src/pages/Repatriation.tsx`, `src/pages/repatriation/RateCards.tsx`, new `RepatriationTransferInvoiceDialog.tsx`.
- No records deleted; all changes audited.
