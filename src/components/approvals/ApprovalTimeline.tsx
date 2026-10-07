import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X, UserPlus, MessageSquare, Send, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const ICONS: Record<string, any> = {
  submitted: Send,
  assigned: UserPlus,
  reassigned: Users,
  approved: Check,
  rejected: X,
  commented: MessageSquare,
};

const TONES: Record<string, string> = {
  submitted: "bg-blue-500/10 text-blue-600",
  assigned: "bg-purple-500/10 text-purple-600",
  reassigned: "bg-amber-500/10 text-amber-600",
  approved: "bg-emerald-500/10 text-emerald-600",
  rejected: "bg-red-500/10 text-red-600",
  commented: "bg-muted text-muted-foreground",
};

interface Props {
  docType: string;
  docId: string;
  className?: string;
}

export function ApprovalTimeline({ docType, docId, className }: Props) {
  const { data: events } = useQuery({
    queryKey: ["approval-events", docType, docId],
    enabled: !!docId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approval_events" as any)
        .select("*")
        .eq("doc_type", docType)
        .eq("doc_id", docId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const userIds = Array.from(
    new Set(
      (events ?? [])
        .flatMap((e: any) => [e.actor_id, e.from_user, e.to_user])
        .filter(Boolean),
    ),
  );

  const { data: profiles } = useQuery({
    queryKey: ["approval-event-profiles", userIds.sort().join(",")],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((p: any) => (map[p.user_id] = p.display_name || p.user_id.slice(0, 8)));
      return map;
    },
  });

  const name = (id?: string | null) =>
    id ? profiles?.[id] ?? id.slice(0, 8) + "…" : "—";

  if (!events?.length) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Approval timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative border-l border-border ml-2 space-y-4">
          {events.map((e: any) => {
            const Icon = ICONS[e.action] ?? MessageSquare;
            return (
              <li key={e.id} className="ml-4">
                <span
                  className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full ${TONES[e.action] ?? "bg-muted"}`}
                >
                  <Icon className="h-3 w-3" />
                </span>
                <div className="flex flex-wrap items-baseline gap-2">
                  <Badge variant="outline" className="capitalize text-[10px]">
                    {e.action}
                  </Badge>
                  <span className="text-sm">
                    {e.action === "reassigned" ? (
                      <>
                        <span className="font-medium">{name(e.actor_id)}</span> moved from{" "}
                        <span className="font-medium">{name(e.from_user)}</span> to{" "}
                        <span className="font-medium">{name(e.to_user)}</span>
                      </>
                    ) : e.action === "assigned" || e.action === "submitted" ? (
                      <>
                        <span className="font-medium">{name(e.actor_id)}</span>
                        {e.to_user ? (
                          <>
                            {" "}→ <span className="font-medium">{name(e.to_user)}</span>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <span className="font-medium">{name(e.actor_id)}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                  </span>
                </div>
                {e.note && (
                  <p className="text-xs text-muted-foreground mt-1 italic">"{e.note}"</p>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
