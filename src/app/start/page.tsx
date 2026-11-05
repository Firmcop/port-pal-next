"use client";

import dynamic from "next/dynamic";
import { FullScreenLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/StartTrial"), { ssr: false, loading: () => <FullScreenLoader /> });

// /start — public
export default function Page() {
  return <Screen />;
}
