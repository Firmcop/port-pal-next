"use client";

import dynamic from "next/dynamic";
import { FullScreenLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/components/shell/PortalLoginGate"), { ssr: false, loading: () => <FullScreenLoader /> });

// /portal/login
export default function Page() {
  return <Screen />;
}
