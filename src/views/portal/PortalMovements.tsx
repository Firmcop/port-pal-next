import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

const typeColors: Record<string, string> = {
  gate_in: "bg-success/15 text-success",
  gate_out: "bg-destructive/15 text-destructive",
  yard_shift: "bg-info/15 text-info",
  reposition: "bg-warning/15 text-warning",
};

export default function PortalMovements() {
  const { customerId } = usePortalAuth();

  const { data: movements, isLoading } = useQuery({
    queryKey: ["portal-movements", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("container_movements")
        .select("*, containers(container_number)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Container Movements</h1>
        <p className="text-muted-foreground">Track movement history for your containers</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Container</TableHead>
                <TableHead>Movement Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={4} />
              ) : !movements?.length ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No movements found</TableCell></TableRow>
              ) : movements.map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono font-medium text-sm">{m.containers?.container_number ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={typeColors[m.movement_type] ?? ""}>{m.movement_type?.replace("_", " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{format(new Date(m.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.notes ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
