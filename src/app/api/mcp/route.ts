import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createSupabaseTokenClient } from "@/integrations/supabase/server";
import { registerTools } from "@/server/mcp/tools";
import { unauthorized } from "@/server/mcp/auth";

/**
 * Port Pal MCP server — lets Claude, ChatGPT, Copilot and any other MCP client
 * query the CDMS on behalf of a signed-in user.
 *
 * Transport: MCP Streamable HTTP, stateless (a fresh server per request), so it
 * scales horizontally on serverless hosts with no sticky sessions.
 * Auth: OAuth 2.1 bearer token issued by Supabase Auth; discovered by clients
 * via /.well-known/oauth-protected-resource.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INSTRUCTIONS =
  "Tools for the Port Pal Container Depot Management System (CDMS). Use them to query containers, " +
  "customers, movements and finance (trial balance, receivables, cash-flow, budgets, loans, data health) " +
  "on behalf of the signed-in user. Results are limited to the user's organization and role. " +
  "Amounts are in the currency stated on each row; the org base currency is in get_finance_dashboard.";

async function handle(request: Request): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return unauthorized(request);

  const db = createSupabaseTokenClient(token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return unauthorized(request, "Token is invalid or expired");

  let clientId: string | null = null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    clientId = payload.client_id ?? payload.azp ?? null;
  } catch {
    /* not a JWT we can decode — fine */
  }

  const server = new McpServer(
    { name: "port-pal-cdms", title: "Port Pal CDMS", version: "2.0.0" },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, { db, userId: data.user.id, email: data.user.email ?? null, clientId });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, {
      authInfo: { token, clientId: clientId ?? "unknown", scopes: [], extra: { userId: data.user.id } },
    });
  } finally {
    // Stateless: release the server once the response is produced.
    queueMicrotask(() => void server.close());
  }
}

export { handle as GET, handle as POST, handle as DELETE };
