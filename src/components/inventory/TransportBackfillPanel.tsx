import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import SupplierCombobox from "@/components/suppliers/SupplierCombobox";

type PreviewRow = {
  container_id: string;
  container_number: string;
  size: string;
  status: string;
  amount: number;
  currency: string;
};

type Result = {
  dry_run: boolean;
  processed: number;
  skipped: number;
  sales_restated: number;
  conversions_restated: number;
  total_amount: number;
  currency: string;
  rows: PreviewRow[];
};

const money = (v: number, c: string) => `${c} ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function csv(rows: PreviewRow[]) {
  const headers = ["container", "size", "status", "amount", "currency"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.map((r) => [r.container_number, r.size, r.status, r.amount, r.currency].map(esc).join(","));
  const url = URL.createObjectURL(new Blob([[headers.join(","), ...body].join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "transport-backfill-dry-run.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Historic transport cost backfill. Raises the missing transport purchase
 * invoice for every container at the size-matched standard rate, writes the
 * cost back onto the container and restates linked sales and conversions.
 * Idempotent — containers that already carry a transport invoice are skipped.
 */
export default function TransportBackfillPanel({ onDone }: { onDone?: () => void }) {
  const { toast } = useToast();
  const [vendor, setVendor] = useState("Transport (Historic)");
  const [rate20, setRate20] = useState("32500");
  const [rate40, setRate40] = useState("40000");
  const [currency, setCurrency] = useState("KES");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const params = () => ({
    _vendor: vendor.trim(),
    _rate_20: Number(rate20) || 0,
    _rate_40: Number(rate40) || 0,
    _currency: currency.trim().toUpperCase(),
  });

  const preview = useQuery({
    queryKey: ["transport-backfill-preview", rate20, rate40, currency],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("backfill_container_transport_costs" as any, {
        ...params(),
        _dry_run: true,
      });
      if (error) throw error;
      return data as unknown as Result;
    },
  });

  const run = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.rpc("backfill_container_transport_costs" as any, {
        ...params(),
        _dry_run: false,
      });
      if (error) throw error;
      const res = data as unknown as Result;
      setResult(res);
      toast({
        title: `${res.processed} transport invoice${res.processed === 1 ? "" : "s"} posted`,
        description: `${res.sales_restated} sale(s) and ${res.conversions_restated} conversion(s) restated — ${money(res.total_amount, res.currency)}`,
      });
      await preview.refetch();
      onDone?.();
    } catch (e: any) {
      toast({ title: "Backfill failed", description: e?.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const plan = preview.data;
  const rows = plan?.rows ?? [];

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Transport costs — historic backfill</CardTitle>
            <CardDescription>
              Posts a transport purchase invoice at the size-matched rate for every container with none, updates the
              container acquisition cost and restates linked sales and conversions. Safe to re-run.
            </CardDescription>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant="default">{plan?.processed ?? 0} to post</Badge>
              <Badge variant="secondary">{plan?.skipped ?? 0} already costed</Badge>
              {plan && <Badge variant="outline">{money(plan.total_amount, plan.currency)}</Badge>}
              {result && (
                <Badge variant="outline">
                  Last run: {result.processed} posted, {result.sales_restated} sales, {result.conversions_restated}{" "}
                  conversions
                </Badge>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => csv(rows)}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
            <Button size="sm" onClick={run} disabled={running || !rows.length || !vendor.trim()}>
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Posting…
                </>
              ) : (
                `Post ${plan?.processed ?? 0} invoice${(plan?.processed ?? 0) === 1 ? "" : "s"}`
              )}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Transport vendor</Label>
            <SupplierCombobox
              value={vendor}
              onChange={(name) => setVendor(name)}
              placeholder="Select transporter"
              extraOptions={["Transport (Historic)"]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">20ft rate</Label>
            <Input type="number" min="0" step="0.01" value={rate20} onChange={(e) => setRate20(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">40ft / 45ft rate</Label>
            <Input type="number" min="0" step="0.01" value={rate40} onChange={(e) => setRate40(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Currency</Label>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {preview.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Building preview…
          </div>
        ) : preview.error ? (
          <p className="text-sm text-destructive">{(preview.error as any)?.message}</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Container status</TableHead>
                  <TableHead className="text-right">Transport cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.container_id}>
                    <TableCell className="font-mono text-xs">{r.container_number}</TableCell>
                    <TableCell>{r.size}ft</TableCell>
                    <TableCell className="text-xs capitalize">{(r.status ?? "—").replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-right">{money(r.amount, r.currency)}</TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      Every container already carries a transport cost.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
