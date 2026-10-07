# Why Peter Cherop, Everflora, Evans and Eng Ben projects don't show for Sharon

## What the data shows

Two separate problems, both confirmed by querying the database.

**1. Those four projects belong to the wrong company.**
Every other project (34 of them) sits under Firmcop's organisation. Exactly these four sit under the legacy "Default Organization":

- Conversion: CNV-PETER-0001
- Conversion: CNV-EVERFLORA-0001
- Conversion: CNV-EVANS-0001
- Conversion: CNV-ENG-0001

Their source conversion jobs are in the Default Organization too. All four were created by the account `dennisraymond714@gmail.com`, which is a member of the Default Organization only — so anything that account creates lands outside Firmcop and is invisible to Firmcop users.

**2. Sharon's roles are not allowed to read the Projects table at all.**
The read rule on projects only admits `admin`, `yard_operator`, `gate_clerk` and `viewer`. Sharon holds `sales_manager`, `production_manager` and `procurement_officer` — none of which are in that list. So even after the four projects are moved, she still would not see the Projects module properly.

## Fix

1. **Move the four orphaned records into Firmcop.** Re-point the four projects and their four conversion jobs (plus any linked containers, materials, labour, costs, invoices and ledger rows attached to them) to Firmcop's organisation, using the existing adoption routine so nothing is left dangling.
2. **Let functional roles see projects.** Extend the Projects read rule to include `sales_manager`, `production_manager`, `procurement_officer`, `accountant` and `asset_manager`, keeping it scoped to the user's own organisation. Do the same for project updates where the role is expected to work on jobs (sales and production managers).
3. **Stop the leak at the source.** Fix the offending account's membership so it belongs to Firmcop, and add a guard so a conversion job cannot be created under the Default Organization when the creator has a real organisation.
4. **Verify as Sharon.** Sign in as Sharon in the preview and confirm the Projects list now shows all 38 projects including the four named ones.

## Technical notes

- Table: `public.projects`, policy "Org members view projects" (SELECT) and "Org staff update projects" (UPDATE) — both use `has_role()` against `user_roles`, which is where the role gap lives.
- Re-parenting will use `adopt_legacy_org_data` (already present) restricted to the four conversion ids, followed by a direct `organization_id` update on the four project rows.
- Affected ids: projects `1b0f4691…`, `6be5a474…`, `09cf5681…`, `7718fdf3…`; conversions `CNV-PETER-0001`, `CNV-EVERFLORA-0001`, `CNV-EVANS-0001`, `CNV-ENG-0001`.
- No frontend changes are expected; `src/pages/finance/Projects.tsx` already filters by the active organisation implicitly through RLS.
