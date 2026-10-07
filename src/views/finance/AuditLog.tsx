import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { History, ExternalLink, Search } from "lucide-react";
import { format } from "date-fns";

const ENTITIES = [
  { value: "all", label: "All entities" },
  { value: "transaction", label: "Ledger posting" },
  { value: "invoice", label: "Invoice" },
  { value: "payment", label: "Customer payment" },
  { value: "vendor_payment", label: "Vendor payment" },
  { value: "reconciliation", label: "Reconciliation" },
  { value: "recon_line", label: "Reconciliation line" },
];

type Row = {
  id: string;
  created_at: string;
  actor_email: string | null;
  entity_type: string;
  entity_id: string;
  entity_ref: string | null;
  action: string;
  summary: Record<string, any>;
  before_data: any;
  after_data: any;
  route: string | null;
};

export default function FinanceAuditLog() {
  const [entity, setEntity] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["finance-audit-log", entity, from, to],
    queryFn: async () => {
      let q = (supabase as any)
        .from("finance_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (entity !== "all") q = q.eq("entity_type", entity);
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", `${to}T23:59:59`);
      const { data, error } = await q;
      if (error) throw error;
      return data as Row[];
    },
  });

  useRealtimeInvalidate(
    [{ table: "finance_audit_log", queryKeys: ["finance-audit-log"] }],
    "rt-finance-audit-log"
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return data ?? [];
    return (data ?? []).filter(
      (r) =>
        (r.entity_ref ?? "").toLowerCase().includes(s) ||
        (r.actor_email ?? "").toLowerCase().includes(s) ||
        r.action.toLowerCase().includes(s) ||
        JSON.stringify(r.summary).toLowerCase().includes(s)
    );
  }, [data, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <History className="h-6 w-6" />
        <div>
          <h1 className="text-2xl font-bold">Finance Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            Every posting, payment, and reconciliation change with replayable links.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ENTITIES.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="w-72 pl-8"
              placeholder="Search ref, user, action…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          {(entity !== "all" || search || from || to) && (
            <Button variant="ghost" size="sm" onClick={() => { setEntity("all"); setSearch(""); setFrom(""); setTo(""); }}>
              Reset
            </Button>
          )}
          <span className="ms-auto text-xs text-muted-foreground self-center">{filtered.length} events</span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">When</TableHead>
                <TableHead className="w-48">Actor</TableHead>
                <TableHead className="w-40">Entity</TableHead>
                <TableHead className="w-36">Action</TableHead>
                <TableHead>Reference / Summary</TableHead>
                <TableHead className="w-28 text-right">Replay</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={6} />
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    No audit entries match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}
                    </TableCell>
                    <TableCell className="text-xs truncate max-w-[12rem]">
                      {r.actor_email ?? <span className="text-muted-foreground">system</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{r.entity_type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{r.action.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.entity_ref && <span className="font-mono mr-2">{r.entity_ref}</span>}
                      <span className="text-muted-foreground">{shortSummary(r.summary)}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.route && (
                        <Button asChild variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                          <Link to={r.route}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Badge variant="outline">{selected.entity_type}</Badge>
                  <Badge variant="secondary">{selected.action.replace(/_/g, " ")}</Badge>
                </SheetTitle>
                <SheetDescription>
                  {format(new Date(selected.created_at), "PPpp")} ·{" "}
                  {selected.actor_email ?? "system"}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 mt-4">
                {selected.route && (
                  <Button asChild size="sm" className="w-full">
                    <Link to={selected.route}>
                      <ExternalLink className="mr-1 h-4 w-4" />Open in module
                    </Link>
                  </Button>
                )}
                <Section title="Summary" value={selected.summary} />
                {selected.before_data && <Section title="Before" value={selected.before_data} />}
                {selected.after_data && <Section title="After" value={selected.after_data} />}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Section({ title, value }: { title: string; value: any }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase mb-1">{title}</p>
      <pre className="text-xs font-mono bg-muted/40 p-3 rounded border overflow-x-auto whitespace-pre-wrap break-all">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function shortSummary(s: Record<string, any>): string {
  if (!s) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(s)) {
    if (v === null || v === undefined || v === "") continue;
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    parts.push(`${k}=${val.length > 40 ? val.slice(0, 40) + "…" : val}`);
    if (parts.length >= 3) break;
  }
  return parts.join("  ·  ");
}
