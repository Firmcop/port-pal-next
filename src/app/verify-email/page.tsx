"use client";

import dynamic from "next/dynamic";
import { FullScreenLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/VerifyEmail"), { ssr: false, loading: () => <FullScreenLoader /> });

// /verify-email — public
export default function Page() {
  return <Screen />;
}
