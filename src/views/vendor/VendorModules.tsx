import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Navigate } from "@/lib/router";
import { useOrganization } from "@/hooks/use-organization";
import { Loader2, Save } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function VendorModules() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { data: modules, isLoading } = useQuery({
    queryKey: ["modules-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.from("modules_catalog").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const [prices, setPrices] = useState<Record<string, string>>({});
  useEffect(() => {
    if (modules) {
      setPrices(Object.fromEntries(modules.map((m) => [m.code, String(m.monthly_price)])));
    }
  }, [modules]);

  const save = useMutation({
    mutationFn: async (code: string) => {
      const price = parseFloat(prices[code] ?? "0");
      const { error } = await supabase.from("modules_catalog").update({ monthly_price: price }).eq("code", code);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Price updated");
      qc.invalidateQueries({ queryKey: ["modules-catalog"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (org.loading) return <Loader2 className="animate-spin" />;
  if (!org.isPlatformAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Module Catalog & Pricing</h1>
        <p className="text-sm text-muted-foreground">Set the per-tenant monthly price for each licensable module.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Modules</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Loader2 className="animate-spin" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Core</TableHead>
                  <TableHead className="w-40">Monthly price</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modules?.map((m) => (
                  <TableRow key={m.code}>
                    <TableCell className="font-mono text-xs">{m.code}</TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.description}</TableCell>
                    <TableCell>{m.is_core ? "Yes" : "—"}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={prices[m.code] ?? ""}
                        onChange={(e) => setPrices({ ...prices, [m.code]: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => save.mutate(m.code)}>
                        <Save className="h-4 w-4" />
                      </Button>
                    </TableCell>
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
