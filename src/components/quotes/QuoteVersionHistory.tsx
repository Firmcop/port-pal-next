import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { diffSnapshots } from "@/lib/quote-diff";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const statusTone: Record<string, string> = {
  submitted: "bg-info/15 text-info",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  manual: "bg-muted text-muted-foreground",
  edit: "bg-muted text-muted-foreground",
};

export default function QuoteVersionHistory({ quoteId }: { quoteId: string }) {
  const { data: versions } = useQuery({
    queryKey: ["quote-versions", quoteId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("quote_versions")
        .select("*")
        .eq("quote_id", quoteId)
        .order("version_no", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!quoteId,
  });

  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");

  const verA = versions?.find((v) => v.id === a);
  const verB = versions?.find((v) => v.id === b);

  const diff = useMemo(() => {
    if (!verB) return null;
    return diffSnapshots(verA?.snapshot ?? null, verB.snapshot);
  }, [verA, verB]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Version Timeline</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!versions?.length && (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No versions yet — snapshots are created on submit, approve, reject, or via "Save snapshot".</TableCell></TableRow>
              )}
              {versions?.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono">v{v.version_no}</TableCell>
                  <TableCell><Badge className={statusTone[v.event] ?? ""} variant="secondary">{v.event}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{v.note ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(Number(v.total_amount))}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(v.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {versions && versions.length >= 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compare Versions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">From (older)</div>
                <Select value={a} onValueChange={setA}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="Pick version" /></SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => <SelectItem key={v.id} value={v.id}>v{v.version_no} · {v.event}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">To (newer)</div>
                <Select value={b} onValueChange={setB}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="Pick version" /></SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => <SelectItem key={v.id} value={v.id}>v{v.version_no} · {v.event}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {diff && (
                <div className="ml-auto text-sm">
                  <span className="text-muted-foreground mr-2">Total change:</span>
                  <span className="font-mono">{fmt(diff.totals.prev)} → {fmt(diff.totals.next)}</span>
                  <span className={`ml-2 font-semibold ${diff.totals.next - diff.totals.prev >= 0 ? "text-success" : "text-destructive"}`}>
                    ({diff.totals.next - diff.totals.prev >= 0 ? "+" : ""}{fmt(diff.totals.next - diff.totals.prev)})
                  </span>
                </div>
              )}
            </div>

            {diff?.sections.map((sd) => (
              <div key={sd.section_id} className="border rounded-md">
                <div className="px-3 py-2 flex items-center justify-between bg-muted/40">
                  <div className="font-medium flex items-center gap-2">
                    {sd.title}
                    {sd.status !== "unchanged" && <Badge variant="secondary" className={
                      sd.status === "added" ? "bg-success/15 text-success" :
                      sd.status === "removed" ? "bg-destructive/15 text-destructive" :
                      "bg-warning/15 text-warning"
                    }>{sd.status}</Badge>}
                  </div>
                  <div className="text-xs font-mono">{fmt(sd.prevSubtotal)} → {fmt(sd.nextSubtotal)}</div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Disc %</TableHead>
                      <TableHead className="text-right">Tax %</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-24">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sd.itemDiffs.map((d) => {
                      const row = d.next ?? d.prev;
                      const cls = d.status === "added" ? "bg-success/5" : d.status === "removed" ? "bg-destructive/5 line-through text-muted-foreground" : "";
                      const f = (k: string) => d.changedFields?.includes(k) ? "bg-warning/15 font-semibold" : "";
                      return (
                        <TableRow key={d.key} className={cls}>
                          <TableCell>{row?.description ?? "—"}</TableCell>
                          <TableCell className={`text-right font-mono ${f("quantity")}`}>{Number(row?.quantity ?? 0)}</TableCell>
                          <TableCell className={`text-right font-mono ${f("unit_price")}`}>{fmt(Number(row?.unit_price ?? 0))}</TableCell>
                          <TableCell className={`text-right font-mono ${f("discount_pct")}`}>{Number(row?.discount_pct ?? 0)}%</TableCell>
                          <TableCell className={`text-right font-mono ${f("tax_pct")}`}>{Number(row?.tax_pct ?? 0)}%</TableCell>
                          <TableCell className="text-right font-mono">{fmt(Number(row?.total_price ?? 0))}</TableCell>
                          <TableCell><Badge variant="secondary">{d.status}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                    {!sd.itemDiffs.length && (
                      <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-3">No items.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
