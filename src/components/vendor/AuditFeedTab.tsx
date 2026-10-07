import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { format } from "date-fns";

const ENTITIES = ["all", "lifecycle", "movement", "work_order", "invoice", "appointment"] as const;

export function AuditFeedTab({ organizationId }: { organizationId: string }) {
  const [entity, setEntity] = useState<string>("all");
  const [before, setBefore] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["org-audit", organizationId, before],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("org_audit_feed", {
        _org_id: organizationId, _limit: 100, _before: before,
      });
      if (error) throw error;
      return data as any[];
    },
  });

  const filtered = (data ?? []).filter((r) => entity === "all" || r.entity === entity);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={entity} onValueChange={setEntity}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ENTITIES.map((e) => <SelectItem key={e} value={e}>{e === "all" ? "All entities" : e}</SelectItem>)}
          </SelectContent>
        </Select>
        {before && (
          <Button variant="outline" size="sm" onClick={() => setBefore(null)}>Reset</Button>
        )}
        <span className="text-xs text-muted-foreground ms-auto">{filtered.length} events shown</span>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">When</TableHead>
              <TableHead className="w-32">Entity</TableHead>
              <TableHead className="w-40">Action</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton columns={4} />
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No activity in the selected window.</TableCell></TableRow>
            ) : (
              filtered.map((r, i) => (
                <TableRow key={`${r.ref_id}-${i}`}>
                  <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.ts), "PPp")}</TableCell>
                  <TableCell><Badge variant="outline">{r.entity}</Badge></TableCell>
                  <TableCell className="text-sm">{String(r.action).replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono truncate max-w-md">
                    {r.summary ? JSON.stringify(r.summary) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {filtered.length >= 100 && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={isFetching}
            onClick={() => setBefore(filtered[filtered.length - 1].ts)}>
            Load older
          </Button>
        </div>
      )}
    </div>
  );
}
