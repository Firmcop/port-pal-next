# Show container numbers on invoices (sales & conversion projects)

## What's happening today

- Invoices already have a single `container_id` field. Container-sale invoices and gate/storage invoices fill it — all 26 sale invoices and all 10 gate-fee invoices are linked.
- Invoices generated from an accepted quote (`generate_invoice_from_quote`) never set a container. That's why conversion-project invoices print "Container: N/A" — 10 of 44 "other" invoices have no container at all.
- Conversion jobs can use several containers (`conversion_containers`), so a single `container_id` is not enough for project invoices.

## What to build

1. **Multi-container link on invoices**
   - New link table `invoice_containers` (invoice, container, org) so an invoice can reference one or many containers, while keeping the existing `container_id` as the "primary" container for backward compatibility.

2. **Auto-capture on invoice creation**
   - Quote → invoice: when the quote is tied to a conversion job, attach every container on that job; when the quote is tied to a container sale, attach the sold container. Set `container_id` to the first/only one.
   - Container sale invoices: also write the link row (keeps everything in one place).
   - Backfill existing invoices where the container is derivable from the quote's conversion job or sale.

3. **Show it everywhere**
   - Invoices list: container column shows all linked container numbers (e.g. `MSCU1234567 +2`).
   - Invoice PDF/print: "Container(s)" row lists every linked number instead of a single value; a project invoice also shows the job number.
   - Text export: same list instead of `N/A`.
   - Manual invoice dialog: allow selecting more than one container.

## Technical notes

- Migration: create `public.invoice_containers` (unique on invoice+container) with GRANTs, RLS scoped by `organization_id` matching existing invoice policies.
- Update `generate_invoice_from_quote` to resolve containers via `container_conversions.quote_id` → `conversion_containers`, and via `container_sales.quote_id` where present; insert into the link table and set `invoices.container_id`.
- One-off data backfill for the 10 unlinked quote invoices where a job/sale link exists.
- Frontend: extend the invoices query select to `invoice_containers(containers(container_number))`, add `container_numbers: string[]` to `InvoicePrintData` in `src/lib/document-templates.ts`, and update `src/pages/Invoices.tsx` (list, export, print, create dialog).
