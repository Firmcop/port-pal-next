"use client";

import dynamic from "next/dynamic";
import { FullScreenLoader } from "@/components/PageLoader";

// The shell depends on the browser session, so it renders client-side only.
// Each screen below it is its own lazily loaded chunk.
const Shell = dynamic(() => import("@/components/shell/AppShell"), {
  ssr: false,
  loading: () => <FullScreenLoader />,
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
