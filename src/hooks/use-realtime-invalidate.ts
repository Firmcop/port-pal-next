import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Spec = { table: string; queryKeys: string[] };

/**
 * Subscribe to postgres changes on a list of tables and invalidate the
 * matching TanStack Query keys whenever any row changes. One channel
 * per hook instance; auto-cleaned on unmount.
 */
export function useRealtimeInvalidate(specs: Spec[], channelName?: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!specs.length) return;
    const name = channelName ?? `rt-${specs.map((s) => s.table).join("-")}`;
    let channel = supabase.channel(name);
    for (const spec of specs) {
      channel = channel.on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: spec.table },
        () => {
          for (const key of spec.queryKeys) {
            qc.invalidateQueries({ queryKey: [key] });
          }
        }
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(specs), channelName]);
}
