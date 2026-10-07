import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bell, Smartphone, Mail, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useOrganization } from "@/hooks/use-organization";
import { usePushSubscription } from "@/hooks/use-push-subscription";

const CATEGORIES: { code: string; label: string; hint: string }[] = [
  { code: "gate", label: "Gate Operations", hint: "Appointments, arrivals, EIR-required alerts" },
  { code: "mr", label: "M&R Approvals", hint: "Estimates pending approval, work order updates" },
  { code: "billing_invoice_posted", label: "Invoice Posted", hint: "An invoice was issued and posted to the ledger" },
  { code: "payment_received", label: "Payment Received", hint: "Customer payment recorded against an invoice" },
  { code: "release_instruction", label: "Release Instructions", hint: "New pickup/delivery instructions from portal/WhatsApp" },
  { code: "sale_completed", label: "Container Sale Completed", hint: "Sale finalised, ownership and ledger updated" },
  { code: "repatriation", label: "Repatriation Events", hint: "Dispatched, completed, cost overruns" },
  { code: "sync_audit_finding", label: "Sync Audit Findings", hint: "Cross-module integrity warnings (admin)" },
  { code: "vendor_payment", label: "Vendor Payments", hint: "Outgoing PO payments processed" },
  { code: "leasing_offhire", label: "Leasing On/Off-Hire", hint: "Lease lifecycle updates and DPP" },
  { code: "logistics_dispatch", label: "Logistics Dispatch", hint: "Transport orders, trip completion" },
  { code: "system", label: "System Notices", hint: "Maintenance, upgrades, billing reminders" },
];

const CHANNELS = [
  { code: "web_push", label: "Web Push", icon: Smartphone },
  { code: "whatsapp", label: "WhatsApp", icon: MessageSquare },
  { code: "email", label: "Email", icon: Mail },
] as const;

type Pref = { event_category: string; channel: string; enabled: boolean };

export default function NotificationPreferencesSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const push = usePushSubscription();

  const { data: prefs = [] } = useQuery({
    queryKey: ["notification-prefs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("event_category, channel, enabled")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data as Pref[];
    },
  });

  const map = useMemo(() => {
    const m = new Map<string, boolean>();
    prefs.forEach((p) => m.set(`${p.event_category}|${p.channel}`, p.enabled));
    return m;
  }, [prefs]);
  const isOn = (cat: string, ch: string) => map.get(`${cat}|${ch}`) ?? true;

  const upsert = useMutation({
    mutationFn: async (row: { event_category: string; channel: string; enabled: boolean }) => {
      if (!user || !organizationId) throw new Error("Not ready");
      const { error } = await supabase.from("notification_preferences").upsert(
        { ...row, user_id: user.id, organization_id: organizationId } as any,
        { onConflict: "user_id,event_category,channel" }
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-prefs", user?.id] }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4" />My Channels</CardTitle>
          <CardDescription>Make sure each channel is connected before relying on it for alerts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between border rounded-lg p-3">
            <div>
              <div className="font-medium text-sm flex items-center gap-2"><Smartphone className="h-4 w-4" />Browser Web Push</div>
              <div className="text-xs text-muted-foreground">
                {push.subscribed ? "Active on this device." : "Subscribe to receive desktop alerts."}
              </div>
            </div>
            <Switch
              checked={push.subscribed}
              onCheckedChange={(v) => (v ? push.subscribe() : push.unsubscribe())}
            />
          </div>
          <div className="flex items-center justify-between border rounded-lg p-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4" />WhatsApp</div>
            <span>Uses your account phone number (configured by admin).</span>
          </div>
          <div className="flex items-center justify-between border rounded-lg p-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2"><Mail className="h-4 w-4" />Email</div>
            <span>Sent to your login email.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event Subscriptions</CardTitle>
          <CardDescription>Choose which alerts reach you through each channel. Defaults to on.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                {CHANNELS.map((c) => (
                  <TableHead key={c.code} className="text-center">
                    <div className="inline-flex items-center gap-1.5"><c.icon className="h-3.5 w-3.5" />{c.label}</div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {CATEGORIES.map((cat) => (
                <TableRow key={cat.code}>
                  <TableCell>
                    <div className="font-medium text-sm">{cat.label}</div>
                    <div className="text-xs text-muted-foreground">{cat.hint}</div>
                  </TableCell>
                  {CHANNELS.map((c) => (
                    <TableCell key={c.code} className="text-center">
                      <Switch
                        checked={isOn(cat.code, c.code)}
                        onCheckedChange={(v) => upsert.mutate({ event_category: cat.code, channel: c.code, enabled: !!v })}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
