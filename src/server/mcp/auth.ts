import "server-only";

/** OAuth 2.1 metadata for the MCP endpoint. Supabase Auth is the authorization server. */

export function siteOrigin(request: Request) {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
}

export function authorizationServer() {
  // Must be the direct Supabase host (not a proxy) so issuer checks in AI clients match the token's `iss`.
  const ref = process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID;
  return ref ? `https://${ref}.supabase.co/auth/v1` : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
}

export function protectedResourceMetadata(request: Request) {
  const origin = siteOrigin(request);
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [authorizationServer()],
    bearer_methods_supported: ["header"],
    resource_name: "Port Pal CDMS",
    resource_documentation: `${origin}/docs/ai-connector.md`,
  };
}

export function unauthorized(request: Request, description = "Sign in to Port Pal to use these tools") {
  const metadataUrl = `${siteOrigin(request)}/.well-known/oauth-protected-resource`;
  return new Response(JSON.stringify({ error: "unauthorized", error_description: description }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", error="invalid_token", error_description="${description}"`,
    },
  });
}
