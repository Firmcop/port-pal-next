import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, History } from "lucide-react";
import { format } from "date-fns";

const EVENT_TYPES = [
"all",
"org_created",
"trial_started",
"trial_extended",
"trial_expired",
"downgraded_to_free",
"module_enabled",
"module_disabled",
"member_deactivated",
];

const EVENT_LABEL: Record<string, string> = {
  org_created: "Organization created",
  trial_started: "Trial started",
  trial_extended: "Trial extended",
  trial_expired: "Trial expired",
  downgraded_to_free: "Downgraded to Free",
  module_enabled: "Module enabled",
  module_disabled: "Module disabled",
  member_deactivated: "Member deactivated",
};

const TONE: Record<string, string> = {
  trial_expired: "destructive",
  downgraded_to_free: "destructive",
  module_disabled: "secondary",
  member_deactivated: "secondary",
};

type EventRow = {
  id: string;
  organization_id: string;
  event_type: string;
  actor_user_id: string | null;
  details: any;
  created_at: string;
  organizations?: { name: string } | null;
};

type Props = { orgId?: string };

export default function VendorLifecycleEvents({ orgId }: Props) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventType, setEventType] = useState("all");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("org_lifecycle_events")
      .select("id, organization_id, event_type, actor_user_id, details, created_at, organizations(name)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (orgId) q = q.eq("organization_id", orgId);
    if (eventType !== "all") q = q.eq("event_type", eventType);
    const { data, error } = await q;
    if (!error) setRows((data ?? []) as EventRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [orgId, eventType]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.event_type.toLowerCase().includes(s) ||
        r.organizations?.name?.toLowerCase().includes(s) ||
        JSON.stringify(r.details ?? {}).toLowerCase().includes(s)
    );
  }, [rows, search]);

  const exportCsv = () => {
    const header = ["timestamp", "organization", "event", "actor_user_id", "details"];
    const lines = [
      header.join(","),
      ...filtered.map((r) =>
        [
          r.created_at,
          (r.organizations?.name ?? r.organization_id).replace(/,/g, " "),
          r.event_type,
          r.actor_user_id ?? "",
          JSON.stringify(r.details ?? {}).replace(/"/g, "'"),
        ].map((v) => `"${v}"`).join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lifecycle-events-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <History className="h-5 w-5 text-primary" />
        <CardTitle className="flex-1">Lifecycle audit log</CardTitle>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
          <Download className="h-4 w-4 mr-2" /> CSV
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Search org / details..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EVENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t === "all" ? "All event types" : EVENT_LABEL[t] ?? t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
        </div>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                {!orgId && <TableHead>Organization</TableHead>}
                <TableHead>Event</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={orgId ? 3 : 4} className="text-center text-muted-foreground py-6">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={orgId ? 3 : 4} className="text-center text-muted-foreground py-6">No events yet.</TableCell></TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(r.created_at), "PPp")}
                    </TableCell>
                    {!orgId && (
                      <TableCell className="font-medium">{r.organizations?.name ?? r.organization_id.slice(0, 8)}</TableCell>
                    )}
                    <TableCell>
                      <Badge variant={(TONE[r.event_type] as any) ?? "outline"}>
                        {EVENT_LABEL[r.event_type] ?? r.event_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs text-muted-foreground">
                        {Object.keys(r.details ?? {}).length ? JSON.stringify(r.details) : "—"}
                      </code>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
