# Contra-settlement, lumpsum payments, and depot ownership on EIRs

Three related finance/operations gaps. Verified against the current database.

## 1. Supplier who is also a customer — net off the balances

**Recommended standard:** IAS 32.42 / IFRS (and ASC 210-20 under US GAAP). Receivables and payables may only be presented net when there is a **legally enforceable right of set-off** and the **intention to settle net**. So the correct treatment is *not* to silently merge the two ledgers — it is:

- Keep AR and AP as separate control accounts and separate documents.
- Record an explicit **contra-settlement** (offset) transaction when both parties agree: `Dr Accounts Payable / Cr Accounts Receivable` for the lower of the two balances, dated and referenced.
- Present a **net counterparty position** in reporting, with the gross AR and AP still visible.

What exists today: `suppliers.linked_customer_id` and `customers.linked_supplier_id` already exist (1 supplier is currently linked), and both `customer_statement` and `supplier_statement` functions exist.

What to build:
- A **Counterparty statement** view for any linked supplier/customer pair: gross AR, gross AP, eligible set-off amount, net position, and a combined chronological statement.
- A `contra_settlements` table plus a `post_contra_settlement` routine that: picks the open sales invoices and supplier invoices to offset, writes allocations against both, posts the `Dr AP / Cr AR` journal in the transaction currency (with FX rate when the two sides differ), and marks the documents part/fully settled.
- Offsets over a configurable threshold route through the existing approval workflow before posting; everything is written to `finance_audit_log`.
- Guard rails: same organization, same counterparty pair, offset capped at min(AR, AP), no offsetting of documents already fully settled, and a reversal routine for mistakes.

## 2. Lumpsum vendor payments (not tied to one PO)

Today `vendor_payments.po_id` is **NOT NULL**, so every payment must name one PO. Allocation plumbing already exists — `vendor_payment_allocations` plus `allocate_vendor_payment` and `auto_allocate_vendor_payment` — but it can only be reached after a PO-specific payment.

What to build:
- Make `po_id` nullable so a payment can be recorded against the **supplier** alone (an on-account payment). Existing rows are unaffected (0 payments currently have a null PO).
- A "Record lumpsum payment" flow: pick supplier, account, amount, currency/FX, then either
  - **Auto-allocate (FIFO by invoice due date)** — proposes a split across that supplier's open invoices, or
  - **Manual split** — enter an amount per invoice.
- The proposal is shown for review first; the unallocated remainder stays as **supplier credit on account** and appears on the supplier statement and in Data Health.
- Allocations above the approval threshold, or any manual split that deviates from FIFO, create an **allocation approval request**; the cash entry posts immediately (`Dr AP-on-account / Cr Bank`), and the reclass to specific invoices posts on approval.
- Unallocated and partially allocated payments get a queue on the Payments page, plus a new Finance Data Health finding.

## 3. EIR ownership after the depot has bought the container

Once a purchase invoice has been raised to the supplier, the container belongs to the depot. On a sale or conversion gate-out, the EIR should read **Original Owner = the depot (Firmcop Group)** and **New Owner = the buyer**.

Today `container_sales.original_owner` is copied from `containers.owner` (e.g. "JJ MES DMCC"), and the EIR prints that value.

What to build:
- Derive the owner at sale/gate-out time: if the container has a live (non-void) **purchase invoice** or `ownership_type = 'depot_owned'`, `original_owner` becomes the depot legal name from organisation/depot settings; otherwise it stays the external owner.
- Keep the acquisition vendor in its own field so procurement is not affected — the acquisition PO/purchase-invoice recipient must still resolve to the real supplier (JJ MES DMCC), not the depot. Existing `recipient_source` logic is updated to read the acquisition vendor rather than `original_owner`.
- EIR print templates show both lines: **Original Owner** (depot) and **New Owner / Buyer**.
- A one-off correction pass on the acquisition-backfill screen to restate `original_owner` on already-sold and converted units that had a purchase invoice, logged with reason.

## Technical notes

- Migrations: `contra_settlements` (+ GRANTs, RLS, org scoping), nullable `vendor_payments.po_id`, `post_contra_settlement`, `record_supplier_onaccount_payment`, extended `auto_allocate_vendor_payment`, and an `unallocated_vendor_payment` / `counterparty_offset_available` finding in `v_finance_data_health`.
- All money paths respect the existing per-document currency and manual FX-rate rules already in place.
- New UI: Finance → Counterparty set-off, a lumpsum payment dialog with allocation preview on the Payments page, and the EIR owner fields in `eir-templates.ts`.
