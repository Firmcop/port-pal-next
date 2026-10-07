import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link, Navigate } from "@/lib/router";
import { useOrganization } from "@/hooks/use-organization";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";

export default function VendorOrganizations() {
  const org = useOrganization();
  const { data: orgs, isLoading } = useQuery({
    queryKey: ["vendor-organizations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, slug, country, currency, status, trial_ends_at, billing_email, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: org.isPlatformAdmin,
  });

  if (org.loading) return <Loader2 className="animate-spin" />;
  if (!org.isPlatformAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
        <p className="text-sm text-muted-foreground">All depot tenants on the platform.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total" value={orgs?.length ?? 0} />
        <StatCard label="Trial" value={orgs?.filter((o) => o.status === "trial").length ?? 0} />
        <StatCard label="Active" value={orgs?.filter((o) => o.status === "active").length ?? 0} />
        <StatCard label="Suspended" value={orgs?.filter((o) => ["past_due", "suspended"].includes(o.status)).length ?? 0} />
      </div>

      <Card>
        <CardHeader><CardTitle>All organizations</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trial ends</TableHead>
                  <TableHead>Billing email</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs?.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">
                      <Link to={`/vendor/organizations/${o.id}`} className="hover:underline text-primary">{o.name}</Link>
                      <div className="text-xs text-muted-foreground">{o.slug}</div>
                    </TableCell>
                    <TableCell>{o.country ?? "—"}</TableCell>
                    <TableCell>{o.currency}</TableCell>
                    <TableCell><StatusBadge status={o.status} /></TableCell>
                    <TableCell className="text-sm">{o.trial_ends_at ? format(new Date(o.trial_ends_at), "PP") : "—"}</TableCell>
                    <TableCell className="text-sm">{o.billing_email ?? "—"}</TableCell>
                    <TableCell className="text-sm">{format(new Date(o.created_at), "PP")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-3xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    trial: "secondary",
    active: "default",
    past_due: "destructive",
    suspended: "destructive",
    cancelled: "outline",
  };
  return <Badge variant={variant[status] ?? "outline"}>{status}</Badge>;
}
