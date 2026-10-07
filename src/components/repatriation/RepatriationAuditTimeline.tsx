import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { History } from "lucide-react";

const eventLabels: Record<string, string> = {
  linked: "Linked to release instruction",
  unlinked: "Unlinked release instruction",
  ro_auto_aligned: "RO auto-aligned",
  reconciled: "Reconciled",
};

export function RepatriationAuditTimeline({ repatriationId }: { repatriationId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["repatriation-audit", repatriationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("repatriation_release_audit" as any)
        .select("*")
        .eq("repatriation_id", repatriationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading history…</div>;
  if (!data?.length) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <History className="h-4 w-4" /> No audit events recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <History className="h-4 w-4" /> Release Audit History
      </div>
      <ul className="space-y-2">
        {data.map((e) => (
          <li key={e.id} className="rounded border bg-background p-2 text-sm">
            <div className="flex items-center justify-between">
              <Badge variant="outline">{eventLabels[e.event_type] ?? e.event_type}</Badge>
              <span className="text-xs text-muted-foreground">
                {e.created_at ? format(new Date(e.created_at), "PP p") : ""}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
              {e.previous_release_order_no && <div>Prev RO: <span className="font-mono">{e.previous_release_order_no}</span></div>}
              {e.new_release_order_no && <div>New RO: <span className="font-mono">{e.new_release_order_no}</span></div>}
              {e.expected_ro && <div>Expected: <span className="font-mono">{e.expected_ro}</span></div>}
              {e.reason && <div>Reason: {e.reason}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
