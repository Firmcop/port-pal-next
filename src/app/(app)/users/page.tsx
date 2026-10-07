"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/Users"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /users
export default function Page() {
  return <Screen />;
}
