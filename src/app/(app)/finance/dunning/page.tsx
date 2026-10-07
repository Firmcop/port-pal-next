"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";
import { RequireRole } from "@/components/RequireRole";

const Screen = dynamic(() => import("@/views/finance/DunningRules"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /finance/dunning
export default function Page() {
  return <RequireModule code="billing"><RequireRole roles={["org_owner","admin"]}><Screen /></RequireRole></RequireModule>;
}
