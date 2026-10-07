import { useEffect, useState } from "react";
import { useNavigate } from "@/lib/router";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";

const routeMap: Record<string, string> = {
  container_movements: "/movements",
  gate_appointments: "/gate-appointments",
  work_orders: "/work-orders",
  containers: "/inventory",
};

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
  reference_type: string | null;
  reference_id: string | null;
}

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    if (!user) return;

    const fetchNotifications = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (data) setNotifications(data);
    };

    fetchNotifications();

    const channel = supabase
      .channel("user-notifications")
      .on(
"postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev].slice(0, 50));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const markAllRead = async () => {
    if (!user) return;
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (!unreadIds.length) return;
    await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const typeColors: Record<string, string> = {
    movement: "bg-info/15",
    appointment: "bg-warning/15",
    work_order: "bg-success/15",
    info: "bg-muted-foreground",
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-72">
          {notifications.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground py-12">
              No notifications yet
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`px-4 py-3 text-sm transition-colors cursor-pointer hover:bg-accent/60 ${!n.is_read ? "bg-accent/40" : ""}`}
                  onClick={async () => {
                    if (!n.is_read) {
                      await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
                      setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: true } : x));
                    }
                    setOpen(false);
                    const route = routeMap[n.type] || (n.reference_type ? routeMap[n.reference_type] : null);
                    if (route) navigate(route);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${typeColors[n.type] || typeColors.info}`} />
                    <span className="font-medium">{n.title}</span>
                  </div>
                  <p className="text-muted-foreground text-xs mt-0.5 ml-4">{n.message}</p>
                  <p className="text-muted-foreground text-[10px] mt-1 ml-4">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
