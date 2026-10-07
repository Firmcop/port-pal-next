# Fix Sub-assembly BOM Material Dropdown Labels

## Problem
In the Sub-assembly BOM dialog, the material dropdown shows blank/white rows because the `SelectItem` label references `c.company_name`, but the catalog query only fetches `name`. This makes it impossible to tell which material is being selected.

## Fix
Update the material `SelectItem` in `src/pages/SubAssemblyStock.tsx` to display `c.name` (with unit and stock) instead of the non-existent `c.company_name`.

## Files to change
- `src/pages/SubAssemblyStock.tsx` — line 292 inside the BOM dialog material dropdown.

## Verification
- Open `/sub-assembly-stock`.
- Click **BOM** on any SKU.
- Open the material dropdown in the add-row.
- Confirm each option now shows the material name, unit, and on-hand quantity.
