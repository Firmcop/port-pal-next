"use client";

import { useAuth } from "@/lib/auth";
import { Navigate } from "@/lib/router";
import Login from "@/views/Login";

/** Was `AuthRoutes`: already signed in → go to the safe `next` target. */
export default function LoginGate() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) {
    const next = new URLSearchParams(window.location.search).get("next");
    const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    return <Navigate to={safe} replace />;
  }
  return <Login />;
}
