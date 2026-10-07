// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "./tools";

/** Minimal chainable stand-in for a Supabase query builder that records calls. */
function fakeDb(rows: unknown[] = [{ id: "1" }]) {
  const calls: { op: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  const chain = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  for (const op of ["select", "order", "limit", "eq", "ilike", "or", "in", "is", "lt", "neq"]) builder[op] = chain(op);
  builder.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
  builder.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
  const db = {
    from: (t: string) => {
      calls.push({ op: "from", args: [t] });
      return builder;
    },
    rpc: (fn: string, args: unknown) => {
      calls.push({ op: "rpc", args: [fn, args] });
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  };
  return { db, calls };
}

async function connect(db: unknown) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, { db: db as never, userId: "u-1", email: "a@b.c", clientId: "claude" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("Port Pal MCP tools", () => {
  it("exposes only read-only tools", async () => {
    const client = await connect(fakeDb().db);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(18);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it("list_recent_movements reads container_movements (the legacy tool queried a non-existent table)", async () => {
    const { db, calls } = fakeDb();
    const client = await connect(db);
    const res = await client.callTool({ name: "list_recent_movements", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(calls.find((c) => c.op === "from")?.args[0]).toBe("container_movements");
  });

  it("list_customers searches company_name, not the missing `name` column", async () => {
    const { db, calls } = fakeDb();
    const client = await connect(db);
    await client.callTool({ name: "list_customers", arguments: { search: "acme" } });
    expect(String(calls.find((c) => c.op === "or")?.args[0])).toContain("company_name.ilike.%acme%");
  });

  it("finance RPC tools pass the expected argument names", async () => {
    const { db, calls } = fakeDb();
    const client = await connect(db);
    await client.callTool({ name: "get_cashflow_forecast", arguments: { weeks: 8 } });
    await client.callTool({
      name: "get_customer_statement",
      arguments: { customer_id: "00000000-0000-4000-8000-000000000001", from: "2026-01-01", to: "2026-06-30" },
    });
    const rpcs = calls.filter((c) => c.op === "rpc").map((c) => c.args);
    expect(rpcs).toContainEqual(["cashflow_forecast", { _weeks: 8 }]);
    expect(rpcs).toContainEqual([
      "customer_statement",
      { _customer: "00000000-0000-4000-8000-000000000001", _from: "2026-01-01", _to: "2026-06-30" },
    ]);
  });

  it("whoami returns the caller identity", async () => {
    const client = await connect(fakeDb().db);
    const res = await client.callTool({ name: "whoami", arguments: {} });
    expect(res.structuredContent).toEqual({ user: { user_id: "u-1", email: "a@b.c", client_id: "claude" } });
  });
});
