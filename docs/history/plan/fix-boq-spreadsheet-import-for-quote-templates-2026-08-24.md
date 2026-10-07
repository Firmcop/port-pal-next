# Fix BOQ spreadsheet import for quote templates

## Why the button is greyed out

"Create Template" stays disabled until the parser produces at least one section with items. Your file produces zero, so nothing is parsed and nothing can be saved.

The importer assumes row 1 of the sheet is the header row and that a column literally named "Section" carries the grouping. Your BOQ is laid out the way real BOQs are:

- Row 1 is a title, row 2 a scope note — the parser reads these as the headers.
- Section headings ("A. CONTAINER SHELLS & STRUCTURAL WORKS") sit as a single merged-style cell in column A, not in a Section column.
- The header row (`Item | Description | Unit | Qty | Unit Rate (KES) | Amount (KES)`) repeats above every section.
- "Unit Rate (KES)" is not one of the recognised price labels, and "Item" collides with "Description" in the alias table.
- Subtotal rows and formula cells (`=D6*E6`) are mixed into the data.

## What will change

Rewrite the spreadsheet parsing so a normal BOQ layout imports without the user reshaping it:

1. **Find the header row** anywhere in the first ~30 rows instead of assuming row 1 — the row that contains a description-like label plus a quantity or rate label wins. Repeated header rows further down are recognised and skipped.
2. **Widen the column labels**: strip trailing units/currency in brackets so "Unit Rate (KES)", "Rate/Unit", "Amount (KES)", "Qty.", "Particulars", "Item Description" all resolve. "Item" only maps to description when there is no separate Description column; when both exist, the code column is prefixed onto the description (e.g. "A1 — Used 40ft High Cube …").
3. **Detect section headings by layout**: a row with text only in the first column (or a lone bold-ish caption) and no quantity/rate starts a new section. Section letter prefixes are kept in the title.
4. **Skip noise rows**: subtotals, totals, grand totals, contingency/summary lines that carry no unit rate, and fully blank rows.
5. **Read computed values, not formulas**: parse with cached values so `=D6*E6` never lands in a numeric field; strip currency symbols, commas and spaces before converting numbers.
6. **Use the last sheet-with-data if the first sheet is empty**, and keep CSV working unchanged.
7. **Explain failures**: when parsing yields nothing, show an inline message under the file picker naming what was missing (no header row found / no priced rows found) instead of leaving a silently disabled button.

The preview/edit table, the section and item insert logic, and the PDF path stay as they are.

## Result for your file

Sections A–(last) come through with their items, quantity, unit and unit rate (Amount is ignored since it is derived), ready to review and save as a template named "Dessert Stars BOQ".

## Technical notes

- All changes are in `src/components/quotes/UploadQuoteFileDialog.tsx`: replace `parseSpreadsheet` with a row-array based reader (`XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })`) plus header detection, alias normalisation, and row classification helpers.
- Add a `parseError`/`parseNote` state rendered under the file input, and keep the Create Template disabled rule unchanged.
- Extract the pure helpers (header detection, row classification, number cleaning) into `src/lib/boq-import.ts` and cover them with a Vitest file using this BOQ's shape as a fixture.
