import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, History } from "lucide-react";

const EVENT_LABELS: Record<string, string> = {
  org_created: "Organization created",
  trial_started: "Trial started",
  trial_extended: "Trial extended",
  trial_restarted: "Trial restarted",
  trial_expired: "Trial expired",
  user_invited: "User invited",
  invitation_resent: "Invitation resent",
  invitation_revoked: "Invitation revoked",
  user_activated: "User activated",
  role_assigned: "Role assigned",
  role_removed: "Role removed",
  member_status_changed: "Member status changed",
  conversion_cancelled: "Conversion cancelled",
  edi_export_generated: "EDI export generated",
  edi_export_downloaded: "EDI export downloaded",
  gate_in_billed: "Gate-in fee billed",
  gate_fee_issued: "Gate-fee invoice issued",
  gate_fee_payment_recorded: "Gate-fee payment recorded",
  gate_fee_voided: "Gate-fee invoice voided",
  gate_fee_refunded: "Gate-fee invoice refunded",
  split_output_planned: "Split output planned",
  split_output_removed: "Split output removed",
  split_children_generated: "Split child containers generated",
  quote_submitted_for_approval: "Quote submitted for approval",
  quote_approved: "Quote approved",
  quote_rejected: "Quote rejected",
  quote_snapshot: "Quote snapshot saved",
  quote_version_created: "Quote version recorded",
  recurring_transfer_posted: "Recurring transfer posted",
  reconciliation_conflict_resolved: "Reconciliation conflict resolved",
  reconciliation_bulk_cleared: "Reconciliation bulk cleared",
  reconciliation_bulk_clear_undone: "Bulk clear undone",
  payslip_posted: "Payslip posted",
  payslip_paid: "Payslip paid",
  payslip_voided: "Payslip voided",
  payslip_submitted_for_approval: "Payslip submitted for approval",
  payslip_approved: "Payslip approved",
  payslip_rejected: "Payslip rejected",
  payslip_payment_reconciled: "Payslip payment reconciled",
  payroll_run_completed: "Payroll run completed",
};

const EVENT_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  trial_extended: "default",
  trial_restarted: "default",
  trial_expired: "destructive",
  invitation_revoked: "destructive",
  role_removed: "destructive",
  user_invited: "secondary",
  user_activated: "default",
  conversion_cancelled: "destructive",
  edi_export_generated: "secondary",
  edi_export_downloaded: "default",
  gate_in_billed: "secondary",
  gate_fee_issued: "default",
  gate_fee_payment_recorded: "default",
  gate_fee_voided: "destructive",
  gate_fee_refunded: "destructive",
  split_output_planned: "secondary",
  split_output_removed: "outline",
  split_children_generated: "default",
  quote_submitted_for_approval: "secondary",
  quote_approved: "default",
  quote_rejected: "destructive",
  quote_snapshot: "outline",
  quote_version_created: "outline",
  recurring_transfer_posted: "default",
  reconciliation_conflict_resolved: "secondary",
  reconciliation_bulk_cleared: "default",
  reconciliation_bulk_clear_undone: "outline",
};

export default function AuditLog() {
  const org = useOrganization();
  const [eventType, setEventType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", org.organizationId],
    enabled: !!org.organizationId,
    queryFn: async () => {
      const { data: events } = await supabase
        .from("org_lifecycle_events")
        .select("id, event_type, actor_user_id, details, created_at")
        .eq("organization_id", org.organizationId!)
        .order("created_at", { ascending: false })
        .limit(500);

      const actorIds = Array.from(new Set((events ?? []).map((e: any) => e.actor_user_id).filter(Boolean)));
      let profiles: any[] = [];
      if (actorIds.length) {
        const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", actorIds);
        profiles = data ?? [];
      }
      const byUser = new Map(profiles.map((p) => [p.user_id, p.display_name]));
      return (events ?? []).map((e: any) => ({
        ...e,
        actor_name: e.actor_user_id ? (byUser.get(e.actor_user_id) ?? "Unknown") : "System",
      }));
    },
  });

  const eventTypes = useMemo(
    () => Array.from(new Set((data ?? []).map((e: any) => e.event_type))).sort(),
    [data],
  );

  const filtered = (data ?? []).filter((e: any) => {
    if (eventType !== "all" && e.event_type !== eventType) return false;
    if (search) {
      const blob = `${e.event_type} ${e.actor_name} ${JSON.stringify(e.details)}`.toLowerCase();
      if (!blob.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="h-6 w-6" /> Audit log
        </h1>
        <p className="text-muted-foreground">
          Every role change, invitation, and lifecycle event for {org.organizationName}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>Search by user, role, or event type.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3 flex-wrap">
          <Input
            placeholder="Search…"
            className="max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All event types</SelectItem>
              {eventTypes.map((t) => (
                <SelectItem key={t} value={t}>{EVENT_LABELS[t] ?? t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[170px]">When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !filtered.length ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No events</TableCell></TableRow>
              ) : filtered.map((e: any) => {
                const open = !!expanded[e.id];
                return (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm whitespace-nowrap">{format(new Date(e.created_at), "PPp")}</TableCell>
                    <TableCell>
                      <Badge variant={EVENT_TONE[e.event_type] ?? "outline"}>
                        {EVENT_LABELS[e.event_type] ?? e.event_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{e.actor_name}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setExpanded((p) => ({ ...p, [e.id]: !p[e.id] }))}
                        className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {open ? "Hide" : "View"} details
                      </button>
                      {open && (
                        <pre className="mt-2 text-xs bg-muted/50 rounded p-2 overflow-x-auto max-w-xl">
                          {JSON.stringify(e.details ?? {}, null, 2)}
                        </pre>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
