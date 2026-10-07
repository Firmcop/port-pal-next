"use client";

import dynamic from "next/dynamic";
import { FullScreenLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/NotFound"), { ssr: false, loading: () => <FullScreenLoader /> });

// Unknown staff URL — rendered inside the app shell like the old "*" route.
export default function Page() {
  return <Screen />;
}
