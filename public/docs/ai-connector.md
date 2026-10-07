# Port Pal AI connector (MCP)

Port Pal exposes its data to AI assistants (Claude, ChatGPT, Microsoft Copilot, Cursor and any other
[Model Context Protocol](https://modelcontextprotocol.io) client) through one endpoint:

```
https://portal.firmcop.com/api/mcp
```

## Connecting

1. In your assistant, add a custom connector / MCP server with the URL above.
2. The assistant discovers the sign-in server from `/.well-known/oauth-protected-resource`.
3. Sign in with your normal Port Pal account and approve access on the consent page.
4. Ask questions in plain language — "which invoices for Acme are overdue?", "what does cash look like over the next 8 weeks?".

Every tool runs as you. Row-level security limits results to your organisation and role, exactly as in the web app.

## Tools (all read-only)

| Area | Tool | What it returns |
|---|---|---|
| Core | `whoami` | Your user id, email and the connecting client |
| Operations | `list_containers` | Containers, filter by status / number |
| | `get_container` | Full record for one container number |
| | `get_container_cost_journey` | Cost build-up of one container |
| | `list_recent_movements` | Latest gate-in/out and yard moves |
| | `list_customers` | Customers, search by company or email |
| Finance | `get_finance_dashboard` | Cash, receivables, MTD revenue / costs / net |
| | `get_trial_balance` | Trial balance, optionally one currency |
| | `get_account_balances` | GL balances by account type |
| | `get_bank_and_cash_balances` | Bank, M-Pesa and cash balances |
| | `list_open_invoices` | Unpaid customer invoices, optionally overdue only |
| | `get_customer_statement` | Statement of account between two dates |
| | `get_project_pnl` | Project / job P&L |
| Planning | `get_cashflow_forecast` | Weekly cash projection |
| | `get_commitments_due` | Payables, loans and recurring items due soon |
| | `list_fiscal_periods` | Periods and open/closed status |
| | `get_budget_variance` | Budget vs actual for a period |
| | `get_loan_balances` | Outstanding loan balances |
| | `get_finance_health` | Data-health findings and unposted documents |

## Supabase Auth settings

The OAuth 2.1 server in Supabase Auth must be enabled, and its consent URL set to
`https://portal.firmcop.com/oauth/consent` (the old `/.lovable/oauth/consent` path still works through a rewrite).
