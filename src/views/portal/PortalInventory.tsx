import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";

const statusColors: Record<string, string> = {
  available: "bg-success/15 text-success",
  in_use: "bg-info/15 text-info",
  damaged: "bg-destructive/15 text-destructive",
  under_repair: "bg-warning/15 text-warning",
  sold: "bg-gray-500/15 text-gray-700",
  converted: "bg-muted text-muted-foreground line-through",
  on_lease: "bg-teal-500/15 text-teal-700",
};

const RETIRED_STATUSES = ["converted", "sold"];

export default function PortalInventory() {
  const { customerId } = usePortalAuth();
  const [search, setSearch] = useState("");

  const { data: containers, isLoading } = useQuery({
    queryKey: ["portal-containers", customerId, search],
    enabled: !!customerId,
    queryFn: async () => {
      let q = supabase
        .from("containers")
        .select("*")
        .not("status", "in", `(${RETIRED_STATUSES.join(",")})`)
        .order("container_number");
      if (search) q = q.ilike("container_number", `%${search}%`);
      const { data, error } = await q.limit(200);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Your Containers</h1>
        <p className="text-muted-foreground">{containers?.length ?? 0} containers in depot</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search container number..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Container #</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>ISO Type</TableHead>
                <TableHead>Gate In</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={6} />
              ) : !containers?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No containers found</TableCell></TableRow>
              ) : containers.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium font-mono">{c.container_number}</TableCell>
                  <TableCell>{c.size}ft</TableCell>
                  <TableCell className="capitalize">{c.category}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusColors[c.status] ?? ""}>{c.status.replace("_", " ")}</Badge>
                  </TableCell>
                  <TableCell>{c.iso_type ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.gate_in_at ? new Date(c.gate_in_at).toLocaleDateString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
