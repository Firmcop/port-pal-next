import { useQuery } from "@tanstack/react-query";
import { getDefaultCurrency } from "@/lib/finance-format";
import { supabase } from "@/integrations/supabase/client";
import { SimpleRegistry } from "@/components/logistics/SimpleRegistry";
import { Map } from "lucide-react";

export default function LogisticsRoutes() {
  const { data: carriers } = useQuery({
    queryKey: ["logistics-carriers-pick"],
    queryFn: async () => (await supabase.from("logistics_carriers").select("id,name").order("name")).data ?? [],
  });

  return (
    <SimpleRegistry
      title="Routes"
      icon={<Map className="h-6 w-6" />}
      table="logistics_routes"
      searchField="name"
      defaultForm={{ code: "", name: "", origin: "", destination: "", distance_km: "", default_duration_min: "", default_carrier_id: "", default_rate: 0, currency: getDefaultCurrency(), is_active: true }}
      fields={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "origin", label: "Origin" },
        { key: "destination", label: "Destination" },
        { key: "distance_km", label: "Distance (km)", type: "number", optional: true },
        { key: "default_duration_min", label: "Duration (min)", type: "number", optional: true },
        { key: "default_carrier_id", label: "Default carrier", type: "select", optional: true,
          options: (carriers ?? []).map((c: any) => ({ value: c.id, label: c.name })) },
        { key: "default_rate", label: "Default rate", type: "number" },
        { key: "currency", label: "Currency" },
      ]}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "origin", label: "Origin" },
        { key: "destination", label: "Destination" },
        { key: "distance_km", label: "Km" },
        { key: "default_rate", label: "Rate" },
      ]}
    />
  );
}
