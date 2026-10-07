"use client";

import dynamic from "next/dynamic";
import { FullScreenLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/OAuthConsent"), { ssr: false, loading: () => <FullScreenLoader /> });

// OAuth consent for MCP / AI clients (was /.lovable/oauth/consent; old URL is rewritten here in next.config.ts)
export default function Page() {
  return <Screen />;
}
