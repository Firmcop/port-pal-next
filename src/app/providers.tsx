"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { applyLanguage } from "@/lib/i18n-locale";
import "@/i18n";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // ERP reference data rarely changes second-to-second; serving it from
        // cache for 30s removes most duplicate round-trips when moving between
        // screens. Realtime invalidation (use-realtime-invalidate) still forces
        // refreshes when rows actually change.
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  useEffect(() => {
    // Apply persisted/detected language to <html lang/dir> on boot.
    applyLanguage(localStorage.getItem("app_lang") || (navigator.language || "en").split("-")[0]);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>{children}</AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
