# Fix: "invoice_currency_locked" when correcting an acquisition cost

## What happens now

Changing a container's acquisition cost from KES to USD fails with `invoice_currency_locked — use override_invoice_currency() to change it`, even after confirming the review dialog.

Confirmed cause: purchase invoices are protected by a currency-immutability trigger on `supplier_invoices`. That trigger only allows a currency change while a per-transaction override flag is set — the dedicated "override invoice currency" admin action sets it, but the acquisition-cost save path (`set_container_acquisition_costs`) rewrites `currency` on the component invoice without setting it, so the trigger blocks the whole save. The offloading/transport rows in the same save are rolled back with it.

## The fix

Update `set_container_acquisition_costs` so that, when a component's currency actually changes:

1. It sets the same per-transaction override flag the dedicated override RPC uses, immediately before the invoice update — scoped to that transaction only, so the protection stays in force everywhere else.
2. It writes an `invoice_currency_audit` row (from currency, to currency, actor, and the reason typed in the dialog), so a currency change made through the cost editor leaves the same trail as one made through the override screen.
3. It keeps the existing guards: only an admin/owner can save, a reason is required, and invoices already paid/cancelled/credited are refused with a clear message naming the invoice rather than a raw trigger error.

The same override-and-audit treatment is applied to the sibling paths that rewrite a component invoice's currency in one save — the acquisition backfill and the bulk acquisition edit both call this RPC, so they are fixed by the same change.

## In the dialog

- The review step already lists the currency change per component; it will also state that the invoice currency will be changed and audited.
- Any remaining server refusal (paid invoice, missing FX rate, not an admin) is shown as a plain-language message naming the invoice number, instead of the raw code seen in the screenshot.

## Technical notes

- Migration: `CREATE OR REPLACE FUNCTION public.set_container_acquisition_costs(...)` — in the branch that runs `UPDATE public.supplier_invoices SET ... currency = _kcur`, add `PERFORM set_config('app.currency_override','true', true)` when `upper(coalesce(_inv.currency,'')) <> _kcur`, followed by the `invoice_currency_audit` insert (`invoice_kind = 'purchase'`). No signature change, no schema change.
- `lock_invoice_currency()` and `override_invoice_currency()` stay exactly as they are.
- Error mapping added in the acquisition edit client (`src/lib/container-acquisition-edit.ts`) plus the review dialog, alongside the existing blocker messages.
