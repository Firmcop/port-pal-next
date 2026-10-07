# AI automations for depot operations — phased rollout

You already have four AI touchpoints live: BOQ/quote document parsing, expense receipt parsing, WhatsApp intent parsing, and quote visuals. The plan below adds the automations with the highest daily time saving, built on the same Lovable AI gateway. Default posture: **AI proposes, a human approves anything that touches the ledger**; read-only outputs (digests, search, replies about status) run automatically.

## Phase 1 — Finance anomaly watchdog (highest value)

A nightly scan that reads your own data and raises findings for review instead of silently posting.

Checks it runs:
- Containers in inventory with missing or partial acquisition invoices (purchase / transport / offloading).
- Invoice currency vs supplier currency vs FX rate mismatches.
- Conversion job container cost drift against the live acquisition split.
- Duplicate supplier invoices (same supplier, amount, near date).
- Sales priced below acquisition cost, or markup outside a set band.
- Delivered/uninvoiced transport orders and containers accruing storage with no billing.
- Approved payroll weeks whose ledger does not balance.

Deterministic SQL does the detection; AI writes the plain-English explanation and suggested fix for each finding. Findings land on a new **Finance Watchdog** screen with severity, the affected record, a deep link, and Acknowledge / Resolve / Ignore actions. Nothing posts automatically.

## Phase 2 — Photo-based damage grading on gate-in

When photos are attached to a container at gate-in, AI reviews them and proposes a condition grade (A/B/C or damaged), a short damage list, and candidate repair lines with estimated hours. The gate clerk sees the suggestion pre-filled on the EIR and can accept or override; the accepted values are what get saved, and the AI suggestion plus the operator's decision are stored for audit.

## Phase 3 — Daily ops digest + customer self-service replies

- **Digest**: one scheduled summary per morning to selected staff (WhatsApp/email via the existing queue) — gate movements, containers past free days, overdue repairs, invoices past due, jobs at risk, open watchdog findings. AI writes the narrative over queried numbers; the numbers are never invented.
- **Customer replies**: extend the existing WhatsApp webhook so container status, storage owing, and release-instruction status are answered automatically from the database, scoped to that customer. Anything outside the answerable set is handed to staff, unchanged from today.

## Phase 4 — Natural-language ops search

An ask bar ("40ft units in yard over 60 days for JJ MES", "unpaid invoices over KES 500k") that turns the question into a safe, parameterised query against a fixed allow-list of views, runs it under the user's own permissions, and shows a normal results table with the interpretation stated above it. No free-form SQL is ever executed.

## Guardrails applied to every phase

- All AI calls run server-side; no keys in the browser.
- Every scheduled job is bounded per run, single-flight locked, idempotent, and pauses itself on credit/policy errors with the pause surfaced to the admin.
- All AI output that would affect money is a proposal with an audit record of who accepted it.
- Results respect existing organization scoping and role permissions.

## Technical notes

- New edge functions: `finance-watchdog-scan` (scheduled via pg_cron), `grade-container-photos`, `ops-digest`, `ops-search`.
- New tables: `ai_findings` (type, severity, entity ref, explanation, suggested action, status, audit) and `ai_job_state` (single-flight lease + paused flag per job); both organization-scoped with RLS and explicit GRANTs.
- Detection logic lives in SQL functions per check so it is testable without model calls; the model only phrases the finding.
- Photo grading sends signed URLs from `container-photos` to a vision-capable chat model and returns a strict JSON schema; the suggestion is stored alongside the EIR, not applied to it.
- Digest delivery reuses `push_notification_queue` and the existing WhatsApp/email senders.
- `ops-search` maps intent to a whitelisted set of parameterised queries — never generated SQL.
- Vitest coverage for the watchdog rule math and the search intent mapping.

Suggested start: Phase 1 only, then review the findings quality before moving on.
