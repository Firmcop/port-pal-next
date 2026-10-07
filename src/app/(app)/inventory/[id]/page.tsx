"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/ContainerDetail"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /inventory/:id
export default function Page() {
  return <RequireModule code="inventory"><Screen /></RequireModule>;
}
