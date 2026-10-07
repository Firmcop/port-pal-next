import { useAppSettings } from "@/hooks/use-app-settings";

/**
 * Backwards-compatible hook. Returns the current organization currency from
 * the global app-settings store. New code should call `useAppSettings()` /
 * `getOrgCurrency()` directly.
 */
export function useOrgCurrency(): { currency: string; isLoading: boolean } {
  const { currency, organizationId } = useAppSettings();
  return { currency, isLoading: !organizationId };
}
