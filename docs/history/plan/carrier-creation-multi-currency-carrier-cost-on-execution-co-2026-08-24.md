# Carrier creation + multi-currency carrier cost on Execution & Costing

## What you get

1. **Pick or create a carrier inline.** The carrier dropdown in the Execution & costing dialog gets a search box and a "＋ Create carrier" option. Creating a carrier asks for name, type (internal / subcontractor), currency, phone/email, and lets you either link an existing supplier or create the supplier record at the same time — so the carrier you hire is also a payable supplier.
2. **Carrier cost in its own currency.** Next to the agreed carrier cost there's a currency selector, independent of the billing currency. If the carrier currency differs from the repat's billing currency, an exchange-rate field appears (prefilled from the stored FX rate for that day, editable) with a live "KES 60,000 x 0.0077 = USD 462.00" preview.
3. **Margin uses the converted cost.** Profitability converts the carrier cost into the repat's billing currency using the declared rate (falling back to the stored FX rate). Rows where no rate is available are flagged the same way existing FX gaps are.

## Technical notes

Database (one migration):
- `repatriations`: add `carrier_cost_currency text`, `carrier_fx_rate numeric`; backfill `carrier_cost_currency` from the repat currency / org currency.
- `set_repatriation_execution`: new optional `_carrier_cost_currency` and `_carrier_fx_rate` args; persist both, default currency to the repat's billing currency, null the rate when currencies match.
- `repat_profitability`: convert `carrier_cost` with `carrier_fx_rate` when set, else `get_fx_rate(org, carrier_cost_currency, currency, dispatched_at)`; keep the existing `fx_ok` flag semantics so unresolved conversions surface as warnings.

Frontend:
- `src/components/repatriation/RepatriationExecutionDialog.tsx`: carrier combobox with create action, new `CreateCarrierDialog`, cost-currency select, reuse `FxRateInput` (already handles stored-rate hint + live preview) for the rate, and pass the new args to the RPC.
- New `src/components/logistics/CreateCarrierDialog.tsx`: inserts into `logistics_carriers` (+ optional `suppliers` row) and returns the new id to the caller; also reusable from the Carriers registry page.
- `src/pages/repatriation/Profitability.tsx`: show the carrier cost in its original currency with the converted value beside it.
