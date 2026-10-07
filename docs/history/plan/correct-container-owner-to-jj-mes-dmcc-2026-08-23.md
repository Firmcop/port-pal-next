# Correct container owner to JJ MES DMCC

Every container whose owner is not already JJ MES DMCC is re-pointed to the real supplier, with an audit trail. No invoices are created or changed.

## What the data shows now

- 63 containers already carry owner "JJ MES DMCC" (62 exact, 1 with a trailing space).
- 62 containers carry something else, across 28 distinct values:
  - Firmcop variants: "Firmcop" (6), "Firmcop Limited " (5), "Firmcop Mombasa Depo" (5), "Firmcop Limited" (3), "Firmcop Group " (10), "Firmcop " (1), "FIRMCOP" (1), "FIRMCOP " (1), "Firmcop Ltd" (1) = 33
  - "EVERFLORA LTD " (1), "Depot" (4), "frd" (4), "Default Organization" (3), NULL (2), empty string (1)
  - Buyer-style names on sold units: BOUYGUES, Container Investment Kenya, JOHJAM PRINTERS, Julius Karimi Micanjo, COREKRAFT, Bomexa, Geoffrey Njuguna, James Maina, Joan Ambogo, JOHN MUKUNA, Mango Tree, Mr. Samuel Han, Mr. Peter Cherop = 14
- 17 of the 62 already have a live purchase invoice; 14 of those are correctly issued to JJ MES DMCC, 1 was issued to "Firmcop Limited" as vendor.

## The correction

1. Set `owner = 'JJ MES DMCC'` on all 62 containers, including sold and converted units.
2. Trim the trailing space on the 1 container reading "JJ MES DMCC " so all 125 read identically.
3. Record each change in the container acquisition audit trail — old owner, new owner, who ran it, and the reason "Owner corrected: acquisition supplier is JJ MES DMCC".
4. Report (not auto-fix) the one purchase invoice whose vendor is "Firmcop Limited" rather than JJ MES DMCC, so it can be corrected deliberately.

No purchase invoices are raised here. Once owners are correct, the existing Acquisition invoice backfill screen will pick up the newly-eligible containers for the JJ MES batch.

## How it runs

A one-off admin action on the existing backfill screen (Inventory > Acquisition invoice backfill), as a new "Owner correction" tab:

- A dry-run table listing every affected container — number, size, status, current owner, new owner — with counts by current owner and a CSV download.
- Nothing is written until "Correct owners" is pressed; each row reports updated or failed as it runs.
- Re-running is safe: containers already reading exactly "JJ MES DMCC" are skipped.

## Technical notes

- New admin-only RPC `correct_container_owner(_container_id uuid, _new_owner text, _reason text)`, security definer, restricted to `admin` / `org_owner`, scoped to `current_org_id()`. It updates `containers.owner` and writes a row to the acquisition audit table used by `AcquisitionAuditPanel`.
- Planning logic goes in `src/lib/acquisition-backfill.ts` (pure, so dry run and execution cannot diverge); UI added as a tab in `src/pages/AcquisitionBackfill.tsx`.
- Containers with status `sold` or `converted` are included, per the decision that owner records the acquisition supplier, not the buyer.
- Sale records keep their own buyer fields; nothing in `container_sales` or `container_conversions` is touched.
