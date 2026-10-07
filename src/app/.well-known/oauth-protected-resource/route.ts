import { protectedResourceMetadata } from "@/server/mcp/auth";

// RFC 9728 metadata: tells AI clients that /api/mcp is protected by Supabase Auth.
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return Response.json(protectedResourceMetadata(request), {
    headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
  });
}
