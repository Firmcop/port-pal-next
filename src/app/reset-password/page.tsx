"use client";

import dynamic from "next/dynamic";
import { FullScreenLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/ResetPassword"), { ssr: false, loading: () => <FullScreenLoader /> });

// /reset-password
export default function Page() {
  return <Screen />;
}
