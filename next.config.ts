import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Tree-shake the big icon / UI barrels so each screen ships only what it uses.
    optimizePackageImports: ["lucide-react", "recharts", "date-fns", "@radix-ui/react-icons"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "storage.googleapis.com" },
    ],
  },
  async rewrites() {
    // Keep the OAuth consent URL that Supabase Auth / existing AI clients were
    // configured with working after the move off Lovable.
    return [
      { source: "/.lovable/oauth/consent", destination: "/oauth/consent" },
      // RFC 9728 path-suffixed form some MCP clients request.
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/.well-known/oauth-protected-resource" },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default nextConfig;
