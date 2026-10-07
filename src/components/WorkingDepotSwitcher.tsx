import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { useWorkingDepot } from "@/hooks/use-working-depot";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Warehouse } from "lucide-react";

/**
 * Header switcher for the user's active "working depot". Persists to
 * `profiles.default_depot_id` so the choice follows the user across devices.
 */
export function WorkingDepotSwitcher() {
  const { organizationId } = useOrganization();
  const { depotId, setWorkingDepot } = useWorkingDepot();

  const { data: depots = [] } = useQuery({
    queryKey: ["working-depot-options", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("depots")
        .select("id, name, is_hq")
        .eq("organization_id", organizationId!)
        .order("is_hq", { ascending: false })
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!depots || depots.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Warehouse className="h-3.5 w-3.5 text-muted-foreground" />
      <Select
        value={depotId ?? ""}
        onValueChange={(v) => setWorkingDepot(v)}
      >
        <SelectTrigger className="h-8 w-[200px]">
          <SelectValue placeholder="Working depot" />
        </SelectTrigger>
        <SelectContent align="end">
          {depots.map((d: any) => (
            <SelectItem key={d.id} value={d.id}>
              {d.name}
              {d.is_hq && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  HQ
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
