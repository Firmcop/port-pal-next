"use client";

import dynamic from "next/dynamic";
import { FullScreenLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/ForgotPassword"), { ssr: false, loading: () => <FullScreenLoader /> });

// /forgot-password
export default function Page() {
  return <Screen />;
}
