"use client";

import dynamic from "next/dynamic";
import { FullScreenLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/components/shell/LoginGate"), { ssr: false, loading: () => <FullScreenLoader /> });

// /login — redirects signed-in users to ?next=
export default function Page() {
  return <Screen />;
}
