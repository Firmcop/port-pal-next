"use client";

import dynamic from "next/dynamic";
import { FullScreenLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/Unsubscribe"), { ssr: false, loading: () => <FullScreenLoader /> });

// /unsubscribe
export default function Page() {
  return <Screen />;
}
