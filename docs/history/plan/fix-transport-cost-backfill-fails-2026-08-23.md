# Fix: transport cost backfill fails

## What is wrong

The backfill errors with `record_container_service_invoice(uuid, unknown, text, numeric, numeric) does not exist`.

The backfill routine calls the invoice helper with its arguments in the wrong order:

```text
called:   (container_id, 'transport', vendor, amount, currency, null)
expected: (container_id, vendor, amount, currency, service_kind, reference, fx_rate)
```

Because it is a dry-run-first screen, the preview works and only the actual "Post invoices" run fails — which matches what you saw.

## The fix

Replace the backfill function so the call passes arguments in the correct order:

- `_container_id` = container id
- `_vendor_name` = the chosen transporter
- `_amount` = size-matched rate (40,000 / 32,500)
- `_currency` = KES
- `_service_kind` = `'transport'`
- `_reference` = the container number (so the generated PO/invoice reference is traceable)
- `_fx_rate` = NULL (same-currency, no override)

Everything else stays as designed: idempotent skip of containers that already hold an `acquisition_transport` invoice, write-back of `transport_cost` / `transport_currency` / `transport_vendor`, and restatement of linked sales and conversions.

## Verification

After the migration, run the dry run and confirm the preview count, then post and confirm invoices were created and no error is returned. No frontend changes are needed.
