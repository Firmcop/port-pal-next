import { useEffect } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, Check } from "lucide-react";
import { format } from "date-fns";

const portalRouteMap: Record<string, string> = {
  container_movements: "/portal/movements",
  gate_appointments: "/portal/appointments",
  work_orders: "/portal/dashboard",
  containers: "/portal/inventory",
};

export default function PortalNotifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: notifications, isLoading } = useQuery({
    queryKey: ["portal-notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  // Realtime subscription for new notifications
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("portal-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["portal-notifications"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, queryClient]);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portal-notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("notifications").update({ is_read: true }).eq("user_id", user!.id).eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portal-notifications"] }),
  });

  const unreadCount = notifications?.filter((n: any) => !n.is_read).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-muted-foreground">{unreadCount} unread</p>
        </div>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" onClick={() => markAllRead.mutate()}>
            <Check className="mr-1 h-4 w-4" />Mark All Read
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Loading...</CardContent></Card>
        ) : !notifications?.length ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">No notifications</CardContent></Card>
        ) : notifications.map((n: any) => (
          <Card key={n.id} className={`${n.is_read ? "opacity-60" : ""} cursor-pointer hover:bg-accent/40 transition-colors`}
            onClick={() => {
              if (!n.is_read) markRead.mutate(n.id);
              const route = portalRouteMap[n.type] || (n.reference_type ? portalRouteMap[n.reference_type] : null);
              if (route) navigate(route);
            }}>
            <CardContent className="py-3 flex items-start gap-3">
              <Bell className={`h-4 w-4 mt-1 ${n.is_read ? "text-muted-foreground" : "text-primary"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{n.title}</p>
                  {!n.is_read && <Badge className="bg-primary/15 text-primary text-[10px]">New</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{n.message}</p>
                <p className="text-xs text-muted-foreground mt-1">{format(new Date(n.created_at), "dd MMM yyyy HH:mm")}</p>
              </div>
              {!n.is_read && (
                <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)}>
                  <Check className="h-3 w-3" />
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
