import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Scale } from "lucide-react";

type Row = {
  source: string;
  label: string;
  revenue: number;
  allocated_cost: number;
  margin: number;
  currency: string;
  fx_ok?: boolean;
};

export function TripCostAllocationCard({ tripId }: { tripId: string }) {
  const [basis, setBasis] = useState<"revenue" | "equal">("revenue");
  const qc = useQueryClient();

  const { data: trip } = useQuery({
    queryKey: ["trip-alloc-basis", tripId],
    enabled: !!tripId,
    queryFn: async () =>
      (await supabase.from("logistics_trips").select("cost_allocation_basis").eq("id", tripId).maybeSingle()).data,
  });

  useEffect(() => {
    if (trip?.cost_allocation_basis) setBasis(trip.cost_allocation_basis as any);
  }, [trip?.cost_allocation_basis]);

  const saveBasis = useMutation({
    mutationFn: async (v: "revenue" | "equal") => {
      const { error } = await supabase.from("logistics_trips").update({ cost_allocation_basis: v }).eq("id", tripId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trip-alloc-basis", tripId] }),
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["trip-cost-allocation", tripId, basis],
    enabled: !!tripId,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc("trip_cost_allocation" as any, {
        _trip_id: tripId,
        _basis: basis,
      });
      if (error) throw error;
      return (data as Row[]) ?? [];
    },
  });

  const money = (n: number, cur: string) =>
    `${cur} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4" /> Shared cost allocation
        </CardTitle>
        <Select
          value={basis}
          onValueChange={(v) => {
            setBasis(v as any);
            saveBasis.mutate(v as any);
          }}
        >
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="revenue">Pro-rata by revenue</SelectItem>
            <SelectItem value="equal">Equal split</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-2/3" /></div>
        ) : !rows?.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No revenue lines on this trip yet — add cargo revenue or link a repatriation.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Revenue line</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Allocated cost</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.source}-${i}`}>
                    <TableCell>
                      <Badge variant="outline" className="mr-2">{r.source === "repat" ? "Repat" : "Cargo"}</Badge>
                      {r.label}
                    </TableCell>
                    <TableCell className="text-right font-mono">{money(r.revenue, r.currency)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {money(r.allocated_cost, r.currency)}
                      {r.fx_ok === false && (
                        <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" aria-label="Missing FX rate" />
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-mono font-medium ${Number(r.margin) >= 0 ? "text-success" : "text-destructive"}`}>
                      {money(r.margin, r.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
