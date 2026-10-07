import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import {
  AppSettings,
  getAppSettings,
  setAppSettings,
  subscribeAppSettings,
} from "@/lib/app-settings";
import { setDefaultCurrency } from "@/lib/finance-format";
import { toPrintableImageUrl } from "@/lib/print-assets";

/**
 * Reactive read of the global app settings. Re-renders the component whenever
 * any setting changes (currency, language, decimals, etc.).
 */
export function useAppSettings(): AppSettings {
  return useSyncExternalStore(subscribeAppSettings, getAppSettings, getAppSettings);
}

/** Probe an image URL to confirm it loads. Resolves true on success. */
async function probeImage(url: string, timeoutMs = 8000): Promise<boolean> {
  const printable = await toPrintableImageUrl(url);
  if (printable.startsWith("data:")) return true;
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !url) return resolve(false);
    const img = new Image();
    const timer = window.setTimeout(() => {
      img.src = "";
      resolve(false);
    }, timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

/**
 * Mount once near the app root. Loads the active organization's settings into
 * the global store and keeps the store in sync via realtime updates on the
 * `organizations` row.
 */
export function useAppSettingsBootstrap() {
  const { organizationId, organizationName } = useOrganization();
  const qc = useQueryClient();
  // Track which logo URLs we've already toasted about, so we don't spam.
  const notifiedRef = useRef<Set<string>>(new Set());

  const { data: org } = useQuery({
    queryKey: ["app-settings-org", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      // Fetch org + HQ depot independently so an HQ fetch error doesn't wipe
      // out the org row (and vice versa). HQ is only used for branding fallbacks.
      const [orgRes, hqRes] = await Promise.all([
        supabase
          .from("organizations")
          .select("id, name, currency, country, config, logo_url, billing_address, tax_id")
          .eq("id", organizationId!)
          .maybeSingle(),
        supabase
          .from("depots")
          .select("logo_url, address_line1, city, country, tax_id")
          .eq("organization_id", organizationId!)
          .eq("is_hq", true)
          .maybeSingle(),
      ]);
      if (orgRes.error) throw orgRes.error;
      const org = orgRes.data as any;
      const hq = (hqRes.data ?? null) as any;

      if (hqRes.error) {
        // HQ fallback lookup failed — surface a retry toast but keep the org
        // row so the rest of the app still works.
        toast.error("Couldn't load HQ branding fallback.", {
          description: hqRes.error.message ?? "Depot logo fallback unavailable.",
          action: {
            label: "Retry",
            onClick: () => qc.invalidateQueries({ queryKey: ["app-settings-org", organizationId] }),
          },
        });
      } else if (org && hq) {
        // Fall back to HQ depot branding when the org row hasn't been filled in.
        if (!org.logo_url) org.logo_url = hq.logo_url ?? null;
        if (!org.billing_address && (hq.address_line1 || hq.city)) {
          org.billing_address = [hq.address_line1, hq.city, hq.country].filter(Boolean).join(", ");
        }
        if (!org.tax_id && hq.tax_id) org.tax_id = hq.tax_id;
      }
      // Attach HQ logo separately so the image-probe step can fall back to it
      // when the primary org logo URL fails to load.
      if (org) (org as any).__hq_logo_url = hq?.logo_url ?? null;
      return org;
    },
  });

  // Verify the resolved logo URL actually loads; if not, fall back to HQ and
  // toast a retry option. Runs whenever the query result changes.
  useEffect(() => {
    if (!org) return;
    const primary = (org as any).logo_url as string | null;
    const hqFallback = (org as any).__hq_logo_url as string | null;
    if (!primary) return;
    let cancelled = false;
    (async () => {
      const ok = await probeImage(primary);
      if (cancelled || ok) return;
      const key = `${organizationId}:${primary}`;
      if (!notifiedRef.current.has(key)) {
        notifiedRef.current.add(key);
        toast.error("Organization logo failed to load.", {
          description: hqFallback && hqFallback !== primary
            ? "Using HQ depot logo as a fallback."
            : "No fallback available.",
          action: {
            label: "Retry",
            onClick: () => {
              notifiedRef.current.delete(key);
              qc.invalidateQueries({ queryKey: ["app-settings-org", organizationId] });
            },
          },
        });
      }
      if (hqFallback && hqFallback !== primary) {
        setAppSettings({ organizationLogoUrl: hqFallback });
      } else {
        setAppSettings({ organizationLogoUrl: null });
      }
    })();
    return () => { cancelled = true; };
  }, [org, organizationId, qc]);


  // Push fetched org into the global store.
  useEffect(() => {
    if (!org) return;
    const config: any = (org as any).config ?? {};
    const currency = (org as any).currency || "USD";
    setAppSettings({
      organizationId: (org as any).id,
      organizationName: (org as any).name ?? organizationName ?? null,
      organizationLogoUrl: (org as any).logo_url ?? null,
      organizationAddress: (org as any).billing_address ?? null,
      organizationTaxId: (org as any).tax_id ?? null,
      currency,
      country: (org as any).country ?? null,
      decimalPlaces: typeof config.decimal_places === "number" ? config.decimal_places : 2,
      currencyPosition: config.currency_position === "after" ? "after" : "before",
      language: config.language || (typeof navigator !== "undefined" ? (navigator.language || "en").split("-")[0] : "en"),
      hiddenFinanceNav: Array.isArray(config?.finance_nav?.hidden)
        ? (config.finance_nav.hidden as unknown[]).filter((k): k is string => typeof k === "string")
        : [],
      timezone: config.timezone || (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"),
      acquisitionDefaults: {
        transportVendor: typeof config?.acquisition_defaults?.transport_vendor === "string" ? config.acquisition_defaults.transport_vendor : "",
        transportCost: Number(config?.acquisition_defaults?.transport_cost) > 0 ? Number(config.acquisition_defaults.transport_cost) : null,
        transportRate20: Number(config?.acquisition_defaults?.transport_rate_20) > 0 ? Number(config.acquisition_defaults.transport_rate_20) : null,
        transportRate40: Number(config?.acquisition_defaults?.transport_rate_40) > 0 ? Number(config.acquisition_defaults.transport_rate_40) : null,
        offloadingVendor: typeof config?.acquisition_defaults?.offloading_vendor === "string" ? config.acquisition_defaults.offloading_vendor : "",
        offloadingCost: Number(config?.acquisition_defaults?.offloading_cost) > 0 ? Number(config.acquisition_defaults.offloading_cost) : null,
      },

    });
    // Keep legacy callers of getDefaultCurrency() working.
    setDefaultCurrency(currency);
  }, [org, organizationName]);

  // Subscribe to realtime row updates so a settings change anywhere in the
  // system (including from another tab/device) propagates instantly.
  useEffect(() => {
    if (!organizationId) return;
    const channel = supabase
      .channel(`app-settings-${organizationId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "organizations", filter: `id=eq.${organizationId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["app-settings-org", organizationId] });
          qc.invalidateQueries({ queryKey: ["org-currency", organizationId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, qc]);
}
