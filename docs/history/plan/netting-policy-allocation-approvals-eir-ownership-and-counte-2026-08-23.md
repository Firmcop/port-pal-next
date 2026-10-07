# Netting policy, allocation approvals, EIR ownership, and counterparty reconciliation

Builds on the set-off and lumpsum payment work already posted to the database (contra settlements, on-account supplier payments, declared FX rates, bank charges to OPEX).

## 1. Accounting policy setting for supplier/customer netting (IAS 32)

A new **Accounting policy** section under Finance settings, stored per organisation:

- **Netting permitted** — off / on. When off, no contra set-off can be posted and statements always show gross AR and AP.
- **Basis of presentation** — "gross with disclosure" (default) or "net presentation", used to decide how statements display the counterparty position.
- **Right of set-off evidence required** — when on, posting a contra requires a reference to the signed set-off agreement plus a note.
- **Auto-offset threshold** — offsets above this amount route to approval before posting.
- **Same-currency only** — blocks offsetting balances across currencies unless a rate is declared.

Statement and journal logic reads this policy instead of hard-coded behaviour:
- `post_contra_settlement` refuses to post when netting is disabled, or when evidence is required but missing, and routes above-threshold offsets to approval.
- Customer and supplier statements gain a **counterparty position** footer: gross AR, gross AP, offsets applied to date, and net position — displayed net only when the policy says net presentation, otherwise gross with the net shown as disclosure.
- Each posted contra records the policy snapshot (basis, threshold, evidence reference) in the audit log, so a later policy change does not rewrite history.

## 2. Approval workflow for lumpsum allocations

Lumpsum supplier payments already auto-allocate FIFO. This adds a review step:

- The payment dialog shows the **proposed allocation** (FIFO by invoice due date) across the supplier's open invoices and open POs, with per-line editing: change an amount, drop a line, add another invoice, leave a remainder on account.
- The system compares the final split against the FIFO proposal. If the split deviates, or the payment exceeds the approval threshold, an **allocation approval request** is created (`doc_type = 'payment_allocation'`) instead of writing the allocations.
- Cash still posts immediately to the supplier on-account balance; the allocation to specific documents posts only once approved. Rejection leaves the payment fully on account.
- A **Pending allocations** queue on the Payments page shows requests awaiting approval, with approve / reject / edit-and-resubmit, and an approvals policy row so admins can set the threshold.
- Every decision is written to the finance audit log with before/after splits.

## 3. EIR ownership on sale and conversion

- Whenever a container is sold or gated out for conversion and the depot has raised a purchase invoice for it (or it is flagged depot-owned), the EIR prints **Original Owner = the depot legal name (Firmcop Group)** and **New Owner = the buyer / conversion customer**. External-owned units keep the real owner.
- The resolved values are persisted on the EIR record itself (owner at issue, new owner, and the reason the depot was used) rather than derived at print time, so a reprint years later matches the original.
- Each EIR gains an **ownership audit entry**: resolved owner, source (purchase invoice number or ownership flag), acquisition supplier retained separately, and who issued it. Shown on the EIR detail drawer.
- The acquisition supplier (JJ MES DMCC) remains the recipient on procurement documents — unchanged.

## 4. Counterparty AP/AR reconciliation report

New **Finance → Counterparty reconciliation** report:

- One row per linked supplier/customer pair per currency: gross AR, gross AP, offsets posted, cash settled, net position, and the eligible set-off amount remaining.
- **Exception flags** for investigation: unlinked counterparties that share a name or tax ID, offsets posted with no matching AP or AR movement, residual balances left after a full offset, cross-currency pairs with no declared rate, unallocated on-account payments, and set-offs posted while the netting policy was disabled.
- Drill-down to the underlying invoices, supplier invoices, payments, and settlements; export to CSV and PDF.
- The same findings surface as cards in the existing Finance Data Health panel.

## Technical notes

- Migration: `accounting_policies` table (org-scoped, RLS + GRANTs) with a `get_accounting_policy()` resolver defaulting to gross presentation; policy checks and snapshot inserted into `post_contra_settlement`; `eir_records` gains `owner_at_issue`, `new_owner`, `owner_source`; new `request_payment_allocation_approval` / `apply_approved_allocation` RPCs plus a `payment_allocation` approval policy row; `v_counterparty_reconciliation` view feeding the report and Data Health.
- UI: Finance settings tab for the policy, allocation editor and pending queue on the Payments page, counterparty reconciliation page, EIR ownership block in `eir-templates.ts` and the EIR detail drawer.
- Also completes the in-flight work: the declared FX rate and bank-charge fields on the contra settlement screen, the lumpsum payment dialog, and the pay-PO dialog now that the backend accepts them.
