# Persist the customer as the new owner on gate-out EIRs

## Problem

When you generate a gate-out EIR and pick a buyer/lessee from the customer registry, that selection is only held in memory for the current browser session. It is never saved on the EIR record, so:

- The printed EIR shows no new owner (or falls back to the old owner).
- Re-opening or re-printing the EIR later loses the customer entirely.
- Ownership history (who owned the unit before vs. after the gate-out) is not recorded.

## What will change

1. When a customer is attached to a gate-out EIR, save that customer as the **new owner** directly on the EIR record, together with the owner the container had at the time of issue.
2. The printed EIR then always shows: original owner (as at gate-out) and new owner = the attached customer, with their contact details.
3. No separate "new owner" text entry is introduced — the attached customer is the single source of truth. Existing free-text fallbacks stay in place only for older records.
4. For sold units, the container's owner in inventory is updated to the buyer so the depot register stays consistent with the EIR.

## Technical detail

- `src/pages/EIRRecords.tsx`, `createEir` mutation: before insert, read the container's current `owner`; set `owner_at_issue` to that value and `new_owner` to the selected customer's `company_name` (when `release_purpose` is `sold_unit` or `lease_unit` and a buyer is selected). Keep `owner_source` as `eir_buyer_selection` for traceability.
- Keep the existing session buyer map as a print-time convenience, but the persisted `new_owner` / `owner_at_issue` becomes the primary source in `buildPrintData`.
- For `sold_unit`, call the existing `correct_container_owner` RPC (reason: `gate_out_sale`) so the inventory owner matches the EIR; lease gate-outs do not transfer ownership.
- No schema change: `eir_records.owner_at_issue`, `new_owner`, `owner_source` already exist.
