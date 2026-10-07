"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/GateAppointments"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /gate/appointments
export default function Page() {
  return <RequireModule code="gate"><Screen /></RequireModule>;
}
