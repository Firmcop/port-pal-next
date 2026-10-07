import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppSettings } from "@/hooks/use-app-settings";
import {
  getContainerAcquisitionBreakdown,
  type AcquisitionBreakdown,
} from "@/lib/container-acquisition-edit";

/**
 * Live acquisition breakdown (purchase vs transport+crane) for a container,
 * derived from its purchase invoices. Sale and conversion forms read the cost
 * from here instead of asking staff to retype it.
 */
export function useContainerAcquisition(containerId?: string | null, containerNumber?: string | null) {
  const { currency } = useAppSettings();
  const qc = useQueryClient();
  const key = ["container-acquisition-breakdown", containerId, currency];

  const query = useQuery<AcquisitionBreakdown>({
    queryKey: key,
    enabled: !!containerId,
    queryFn: () => getContainerAcquisitionBreakdown(containerId, currency, containerNumber),
  });

  useEffect(() => {
    if (!containerId) return;
    // Unique channel name per hook instance — two components watching the same
    // container must not reuse (and re-subscribe to) one channel.
    const channel = supabase
      .channel(`acq-breakdown-${containerId}-${Math.random().toString(36).slice(2)}`)
      .on(

        "postgres_changes",
        { event: "*", schema: "public", table: "supplier_invoices", filter: `container_id=eq.${containerId}` },
        () => qc.invalidateQueries({ queryKey: key }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, currency]);

  return query;
}
