import { useQuery } from "@tanstack/react-query";
import { previewConversionResync, isDrifted, type ResyncPreviewRow } from "@/lib/conversion-cost-sync";

/** Live vs stored container costs for a single conversion job. */
export function useConversionCostSync(conversionId?: string | null) {
  return useQuery<ResyncPreviewRow[]>({
    queryKey: ["conversion-cost-sync", conversionId],
    enabled: !!conversionId,
    queryFn: () => previewConversionResync(conversionId),
  });
}

/** Drift across every conversion job — used for list badges and the review screen. */
export function useAllConversionCostSync(enabled = true) {
  return useQuery<ResyncPreviewRow[]>({
    queryKey: ["conversion-cost-sync", "all"],
    enabled,
    queryFn: () => previewConversionResync(null),
    staleTime: 60_000,
  });
}

export { isDrifted };
