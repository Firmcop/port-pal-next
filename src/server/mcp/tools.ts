import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Port Pal AI tools.
 *
 * Every tool runs with the caller's own Supabase access token, so Postgres
 * row-level security limits results to their organisation and role exactly as
 * in the web app. All tools here are read-only; write actions should go through
 * the existing approval workflow (`submit_for_approval`) rather than posting
 * to the ledger directly.
 */

export interface ToolContext {
  db: SupabaseClient<Database>;
  userId: string;
  email: string | null;
  clientId: string | null;
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

function ok(key: string, data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data ?? null) }],
    structuredContent: { [key]: data ?? null },
  };
}
function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// The generated types don't cover every view/RPC signature precisely; this keeps call sites terse.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = (ctx: ToolContext) => ctx.db as SupabaseClient<any>;

const limitArg = z.number().int().min(1).max(200).optional().describe("Max rows to return (default 50).");

export function registerTools(server: McpServer, ctx: ToolContext) {
  /* ---------------------------------------------------------------- core */

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description: "Return the signed-in user's id, email and OAuth client id — useful to verify the connection.",
      annotations: READ_ONLY,
    },
    async () => ok("user", { user_id: ctx.userId, email: ctx.email, client_id: ctx.clientId }),
  );

  /* ---------------------------------------------------------- operations */

  server.registerTool(
    "list_containers",
    {
      title: "List containers",
      description:
        "List containers in the signed-in user's organization, newest activity first. Optional filters by status and container number substring.",
      inputSchema: {
        status: z.string().optional().describe("Status filter, e.g. 'in_yard', 'gate_out', 'sold'."),
        search: z.string().optional().describe("Case-insensitive substring of container_number."),
        limit: limitArg,
      },
      annotations: READ_ONLY,
    },
    async ({ status, search, limit }) => {
      let q = ctx.db
        .from("containers")
        .select(
          "id, container_number, iso_type, size, status, category, is_empty, owner, shipping_line, customer_id, depot_id, block_id, row, bay, tier, gate_in_at, gate_out_at, updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(limit ?? 50);
      if (status) q = q.eq("status", status as never);
      if (search) q = q.ilike("container_number", `%${search}%`);
      const { data, error } = await q;
      return error ? fail(error.message) : ok("containers", data);
    },
  );

  server.registerTool(
    "get_container",
    {
      title: "Get container",
      description: "Fetch full details for a single container by container_number.",
      inputSchema: { container_number: z.string().trim().min(1).describe("Container number, e.g. 'MSCU1234567'.") },
      annotations: READ_ONLY,
    },
    async ({ container_number }) => {
      const { data, error } = await ctx.db
        .from("containers")
        .select("*")
        .eq("container_number", container_number)
        .maybeSingle();
      if (error) return fail(error.message);
      if (!data) return fail("Container not found");
      return ok("container", data);
    },
  );

  server.registerTool(
    "get_container_cost_journey",
    {
      title: "Get container cost journey",
      description:
        "Full cost build-up for one container (acquisition, transport, offloading, conversion, sale) as recorded in the ledger.",
      inputSchema: { container_id: z.string().uuid().describe("Container id (from list_containers / get_container).") },
      annotations: READ_ONLY,
    },
    async ({ container_id }) => {
      const { data, error } = await anyDb(ctx).rpc("container_cost_journey", { _container_id: container_id });
      return error ? fail(error.message) : ok("journey", data);
    },
  );

  server.registerTool(
    "list_recent_movements",
    {
      title: "List recent container movements",
      description: "Most recent container movements (gate-in/out, yard moves) for the user's organization.",
      inputSchema: {
        movement_type: z.string().optional().describe("Exact movement_type filter."),
        limit: limitArg,
      },
      annotations: READ_ONLY,
    },
    async ({ movement_type, limit }) => {
      let q = ctx.db
        .from("container_movements")
        .select(
          "id, container_id, movement_type, from_block_id, from_row, from_bay, from_tier, to_block_id, to_row, to_bay, to_tier, notes, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit ?? 50);
      if (movement_type) q = q.eq("movement_type", movement_type as never);
      const { data, error } = await q;
      return error ? fail(error.message) : ok("movements", data);
    },
  );

  server.registerTool(
    "list_customers",
    {
      title: "List customers",
      description: "Customers in the user's organization. Optional company name / email substring search.",
      inputSchema: {
        search: z.string().optional().describe("Case-insensitive substring of company name or email."),
        limit: limitArg,
      },
      annotations: READ_ONLY,
    },
    async ({ search, limit }) => {
      let q = ctx.db
        .from("customers")
        .select("id, company_name, contact_person, email, phone, currency, customer_type, kra_pin, is_active, created_at")
        .order("created_at", { ascending: false })
        .limit(limit ?? 50);
      if (search) {
        const s = search.replace(/[%,()]/g, " ");
        q = q.or(`company_name.ilike.%${s}%,email.ilike.%${s}%`);
      }
      const { data, error } = await q;
      return error ? fail(error.message) : ok("customers", data);
    },
  );

  /* -------------------------------------------------------------- finance */

  server.registerTool(
    "get_finance_dashboard",
    {
      title: "Get finance dashboard metrics",
      description:
        "Organization finance KPIs in base currency: cash on hand, receivables, MTD revenue / COGS / expense / net, reconciliation status.",
      annotations: READ_ONLY,
    },
    async () => {
      const { data, error } = await ctx.db.from("finance_dashboard_metrics").select("*").maybeSingle();
      return error ? fail(error.message) : ok("metrics", data ?? {});
    },
  );

  server.registerTool(
    "get_trial_balance",
    {
      title: "Get trial balance",
      description: "Trial balance by GL account (debits, credits, balance). Optionally restricted to one currency.",
      inputSchema: { currency: z.string().length(3).optional().describe("ISO currency code, e.g. 'KES' or 'USD'.") },
      annotations: READ_ONLY,
    },
    async ({ currency }) => {
      const { data, error } = await anyDb(ctx).rpc("finance_trial_balance", currency ? { _currency: currency } : {});
      return error ? fail(error.message) : ok("trial_balance", data);
    },
  );

  server.registerTool(
    "get_account_balances",
    {
      title: "Get GL account balances",
      description: "Balance of every general-ledger account, optionally filtered by account type.",
      inputSchema: {
        account_type: z
          .enum(["asset", "liability", "equity", "revenue", "cost_of_goods", "expense"])
          .optional()
          .describe("Restrict to one account type."),
      },
      annotations: READ_ONLY,
    },
    async ({ account_type }) => {
      let q = ctx.db
        .from("v_account_balances")
        .select("code, name, account_type, currency, total_debit, total_credit, balance")
        .order("code");
      if (account_type) q = q.eq("account_type", account_type);
      const { data, error } = await q;
      return error ? fail(error.message) : ok("accounts", data);
    },
  );

  server.registerTool(
    "get_bank_and_cash_balances",
    {
      title: "Get bank & cash balances",
      description: "Current and cleared balance of each bank, M-Pesa and cash account.",
      annotations: READ_ONLY,
    },
    async () => {
      const { data, error } = await ctx.db
        .from("financial_account_balances")
        .select("account_id, name, account_type, currency, opening_balance, current_balance, cleared_balance, is_active")
        .order("name");
      return error ? fail(error.message) : ok("accounts", data);
    },
  );

  server.registerTool(
    "list_open_invoices",
    {
      title: "List open customer invoices",
      description: "Unpaid / partially paid customer invoices, oldest due date first — the basis for receivables follow-up.",
      inputSchema: {
        customer_id: z.string().uuid().optional().describe("Only this customer."),
        overdue_only: z.boolean().optional().describe("Only invoices past their due date."),
        limit: limitArg,
      },
      annotations: READ_ONLY,
    },
    async ({ customer_id, overdue_only, limit }) => {
      let q = ctx.db
        .from("invoices")
        .select("id, invoice_number, customer_id, customer_name, currency, total_amount, partially_paid, status, issued_at, due_at")
        .in("status", ["sent", "overdue"])
        .is("voided_at", null)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(limit ?? 50);
      if (customer_id) q = q.eq("customer_id", customer_id);
      if (overdue_only) q = q.lt("due_at", new Date().toISOString());
      const { data, error } = await q;
      return error ? fail(error.message) : ok("invoices", data);
    },
  );

  server.registerTool(
    "get_customer_statement",
    {
      title: "Get customer statement",
      description: "Statement of account for one customer between two dates (opening balance, invoices, payments, closing balance).",
      inputSchema: {
        customer_id: z.string().uuid(),
        from: z.string().date().describe("Start date, YYYY-MM-DD."),
        to: z.string().date().describe("End date, YYYY-MM-DD."),
      },
      annotations: READ_ONLY,
    },
    async ({ customer_id, from, to }) => {
      const { data, error } = await anyDb(ctx).rpc("customer_statement", { _customer: customer_id, _from: from, _to: to });
      return error ? fail(error.message) : ok("statement", data);
    },
  );

  server.registerTool(
    "get_cashflow_forecast",
    {
      title: "Get cash-flow forecast",
      description: "Week-by-week projected cash in / out / closing balance from open receivables, payables, loans and recurring items.",
      inputSchema: { weeks: z.number().int().min(1).max(52).optional().describe("Horizon in weeks (default 13).") },
      annotations: READ_ONLY,
    },
    async ({ weeks }) => {
      const { data, error } = await anyDb(ctx).rpc("cashflow_forecast", { _weeks: weeks ?? 13 });
      return error ? fail(error.message) : ok("forecast", data);
    },
  );

  server.registerTool(
    "get_commitments_due",
    {
      title: "Get upcoming commitments",
      description: "Payables, loan instalments and recurring expenses falling due within the next N days.",
      inputSchema: { days: z.number().int().min(1).max(365).optional().describe("Look-ahead window in days (default 30).") },
      annotations: READ_ONLY,
    },
    async ({ days }) => {
      const { data, error } = await anyDb(ctx).rpc("commitments_due", { _days: days ?? 30 });
      return error ? fail(error.message) : ok("commitments", data);
    },
  );

  server.registerTool(
    "get_project_pnl",
    {
      title: "Get project / job P&L",
      description: "Revenue, direct costs and margin per project or conversion job over a date range.",
      inputSchema: {
        from: z.string().date().optional().describe("Start date, YYYY-MM-DD."),
        to: z.string().date().optional().describe("End date, YYYY-MM-DD."),
      },
      annotations: READ_ONLY,
    },
    async ({ from, to }) => {
      const args: Record<string, string> = {};
      if (from) args._from = from;
      if (to) args._to = to;
      const { data, error } = await anyDb(ctx).rpc("project_pnl_report", args);
      return error ? fail(error.message) : ok("projects", data);
    },
  );

  server.registerTool(
    "list_fiscal_periods",
    {
      title: "List fiscal periods",
      description: "Fiscal periods with open / closed status — use the id with get_budget_variance.",
      inputSchema: { year: z.number().int().optional().describe("Only this fiscal year.") },
      annotations: READ_ONLY,
    },
    async ({ year }) => {
      let q = ctx.db
        .from("fiscal_periods")
        .select("id, year, month, start_date, end_date, status, closed_at")
        .order("start_date", { ascending: false })
        .limit(36);
      if (year) q = q.eq("year", year);
      const { data, error } = await q;
      return error ? fail(error.message) : ok("periods", data);
    },
  );

  server.registerTool(
    "get_budget_variance",
    {
      title: "Get budget variance",
      description: "Budget vs actual by account for one fiscal period.",
      inputSchema: { period_id: z.string().uuid().describe("Fiscal period id from list_fiscal_periods.") },
      annotations: READ_ONLY,
    },
    async ({ period_id }) => {
      const { data, error } = await anyDb(ctx).rpc("budget_variance", { _period_id: period_id });
      return error ? fail(error.message) : ok("variance", data);
    },
  );

  server.registerTool(
    "get_loan_balances",
    {
      title: "Get loan balances",
      description: "Outstanding principal, accrued interest and next instalment for each loan facility.",
      annotations: READ_ONLY,
    },
    async () => {
      const { data, error } = await anyDb(ctx).rpc("loan_balances");
      return error ? fail(error.message) : ok("loans", data);
    },
  );

  server.registerTool(
    "get_finance_health",
    {
      title: "Get finance data-health findings",
      description:
        "Finance integrity checks: unposted documents, unbalanced entries, missing postings and currency exceptions. Use before period close.",
      annotations: READ_ONLY,
    },
    async () => {
      const [health, unposted] = await Promise.all([
        ctx.db.from("v_finance_data_health").select("finding_code, severity, count, detail"),
        ctx.db
          .from("v_unposted_documents")
          .select("doc_type, doc_number, doc_date, amount, currency")
          .order("doc_date", { ascending: false })
          .limit(100),
      ]);
      if (health.error) return fail(health.error.message);
      if (unposted.error) return fail(unposted.error.message);
      return ok("health", { findings: health.data, unposted_documents: unposted.data });
    },
  );
}
