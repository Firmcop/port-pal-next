# Repatriation: rate cards, handling fee, and trip profitability

Today a repatriation carries a single free-typed `charge_amount`, and billing to the owner
(`bill_repatriation_to_owner`) picks gate-in / storage / handling from the depot **tariff** table,
which has no notion of a route (Nairobi → Kampala, Mombasa → Nairobi). There is also no link
between a repatriation and a logistics trip, so hired-truck cost or shared own-truck cost never
lands against the repat revenue. This roadmap fixes all three.

## Phase 1 — Repat rate card (route pricing placeholder)

New rate card table so pricing is maintained, not typed:

- Origin depot / location, destination (e.g. "Kampala – multiple depots"), container size (20/40/45),
  shipping line (optional, for line-specific rates), rate amount + currency,
  handling fee (defaults to USD 30), effective_from / effective_to.
- Admin screen **Repatriation → Rate Cards** with add / edit / expire, history preserved
  (a new row supersedes; old rows keep their date range so past invoices stay explainable).
- On creating a repatriation, the rate is looked up automatically from
  (origin, destination, size, line, date) and pre-filled — still editable by admins with a reason,
  captured in the existing audit trail.

## Phase 2 — Handling charge as a proper line

- Handling (default USD 30/container) becomes a repat-specific charge sourced from the rate card,
  no longer only the depot tariff `handling_fee`.
- `preview_repatriation_bill` and `bill_repatriation_to_owner` gain an explicit
  "Repat transport (route)" and "Repat handling" split, so the owner invoice shows both lines.
- The existing bill-preview dialog is updated to show route, rate card used, and both lines.

## Phase 3 — Execution mode: hired truck vs own truck

Each repatriation gets an execution mode:

1. **Subcontracted** — pick a registered carrier and the agreed pay rate.
   A supplier invoice/cost is raised to that carrier; repat margin = charged − carrier cost.
   The pay rate can come from the existing `logistics_carrier_rates` for that route.
2. **Own truck** — link the repatriation to a logistics **trip**. The repat charge is posted as a
   revenue line on that trip (`logistics_trip_revenue`) alongside the cargo revenue, so both share
   the trip's fuel, tolls, driver and mileage costs already captured in `logistics_trip_costs`.

## Phase 4 — Shared-cost allocation and margin reporting

- Trip costs are allocated across the trip's revenue lines (cargo + repat) pro-rata by revenue value
  by default; an alternative basis (equal split per leg) is selectable per trip.
- New **Repatriation Profitability** report: per repat and per route — charged, handling,
  carrier cost or allocated trip cost, net margin, and margin %.
- Trip detail gains a "Repat units on this trip" section showing the container(s) delivered and the
  repat revenue attributed to the trip.

## Phase 5 — Backfill and guardrails

- Backfill the 19 existing repatriations: attach the matching route rate where one can be inferred,
  and flag those with no rate card so finance can price them.
- Guardrail: completing a repat with no rate card and no manual charge warns before invoicing;
  own-truck repats without a linked trip are flagged in the finance data-health card.

## Technical notes

- New tables: `repat_rate_cards` (org-scoped, RLS + GRANTs, currency trigger),
  plus `repatriations.rate_card_id`, `handling_amount`, `execution_mode`, `carrier_id`, `trip_id`.
- New/updated RPCs: `lookup_repat_rate(origin, destination, size, line, on_date)`,
  updated `preview_repatriation_bill` / `bill_repatriation_to_owner`,
  `allocate_trip_costs(trip_id, basis)`, `repat_profitability(from, to)`.
- Reuses existing logistics carriers, carrier rates, trips, trip costs and trip revenue tables —
  no parallel costing engine.
- All money fields respect the org currency trigger and existing FX rate resolution for
  USD rate cards billed on KES accounts.
