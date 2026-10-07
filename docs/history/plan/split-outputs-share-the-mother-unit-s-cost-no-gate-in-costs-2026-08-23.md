# Split outputs: share the mother unit's cost, no gate-in costs of their own

## What is wrong today

Checked the live data and the completion routine:

- **Transport & crane are left out of the split.** `complete_conversion` builds the shareable total as `container_cost + materials + labour + services + sub-assemblies` and ignores `transport_offloading_cost`. On CNV-NOCUST-0006 the job holds container 91,560 + transport/crane 34,500, but only 102,587.50 was shared out (51,293.75 per child) — the 34,500 never reached the children.
- **Child units were given their own acquisition invoices.** Every split child (AXIU1503496(A/B), AXIU1617009(A/B), MOTU 0773577(A/B)) carries a purchase invoice (USD 700), a transport invoice (KES 32,500) and a crane/offloading invoice (KES 2,000) created by the backfill runs. The mother unit was already costed, so this double-counts acquisition cost and inflates AP.
- **Cost read paths disagree.** A child's `acquisition_cost` column holds the allocated share, but sale pricing and the acquisition panels derive cost from `supplier_invoices`. For WEDU 3846736(A/B) (no invoices) that reads as zero; for the others it reads the wrongly created invoices instead of the share.

## The fix

**1. Share the full job cost across outputs**
- Include `transport_offloading_cost` in the amount split at completion, alongside purchase cost, materials, labour, services and sub-assemblies.
- Allocation stays equal per produced unit (2 × 10ft from one 20ft each take half), recorded in `conversion_output_costs` with the existing snapshot so the breakdown shows purchase / transport & crane / materials / labour separately per child.
- The child's `acquisition_cost` equals its share — that is its entry cost for sale or further conversion.

**2. Children never get their own acquisition costs**
- Block acquisition invoicing (purchase, transport, crane/offloading) for any container with a `parent_container_id`, in the intake path, `record_container_service_invoice`, the transport backfill and the acquisition backfill screen — they inherit from the mother.
- No gate-in movement, EIR or gate fee is generated for split children; they enter stock already inside the yard.

**3. Cost reads come from the allocation, not from invoices**
- For a split child, the acquisition breakdown (both the `container_acquisition_split` function and the frontend `splitAcquisition` path) returns the allocated share from `conversion_output_costs`, labelled "from split of <mother number>", instead of scanning `supplier_invoices`.
- Container detail, sale pricing and conversion attach all then show the same number.

**4. Clean up the existing data**
- Reverse the 18 wrongly raised acquisition invoices on the six existing split children (credit/cancel with a reason so the AP ledger and the supplier balances unwind), leaving the mother units' invoices intact.
- Recompute and restate the allocated cost for the completed split jobs so each child carries its correct share including transport & crane, and refresh the affected sale entry prices.

## Technical notes

- Migration updates `complete_conversion` (split branch: add `transport_offloading_cost` to `_total` and to the per-child snapshot totals), adds a `recompute_split_output_costs(_conversion_id, _reason)` RPC used for restating completed jobs, and guards child containers in `record_container_service_invoice` / `backfill_container_transport_costs` / the acquisition backfill RPCs.
- `container_acquisition_split` gains a split-child branch reading `conversion_output_costs`; `src/lib/container-acquisition-edit.ts` and `use-container-acquisition.ts` follow the same rule so the UI cannot diverge.
- Data repair runs as SQL over the six children listed above; each reversal carries a reason and lands in the finance audit trail.
