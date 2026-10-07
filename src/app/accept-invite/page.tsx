"use client";

import dynamic from "next/dynamic";
import { FullScreenLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/AcceptInvite"), { ssr: false, loading: () => <FullScreenLoader /> });

// /accept-invite
export default function Page() {
  return <Screen />;
}
