"use client";

import dynamic from "next/dynamic";
import { FullScreenLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/Onboarding"), { ssr: false, loading: () => <FullScreenLoader /> });

// /onboarding
export default function Page() {
  return <Screen />;
}
