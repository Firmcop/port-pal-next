"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/logistics/Drivers"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /logistics/drivers
export default function Page() {
  return <RequireModule code="logistics"><Screen /></RequireModule>;
}
