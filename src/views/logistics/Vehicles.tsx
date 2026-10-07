import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SimpleRegistry, StatusBadge } from "@/components/logistics/SimpleRegistry";
import { Truck } from "lucide-react";

export default function LogisticsVehicles() {
  const { data: carriers } = useQuery({
    queryKey: ["logistics-carriers-pick"],
    queryFn: async () => (await supabase.from("logistics_carriers").select("id,name").order("name")).data ?? [],
  });

  return (
    <SimpleRegistry
      title="Fleet Vehicles"
      icon={<Truck className="h-6 w-6" />}
      table="logistics_vehicles"
      searchField="registration"
      orderBy="registration"
      defaultForm={{ registration: "", type: "truck", make: "", model: "", capacity_tons: "", container_slots: 1, ownership: "own", carrier_id: "", status: "available", odometer: 0, insurance_expiry: "", notes: "", is_active: true }}
      fields={[
        { key: "registration", label: "Registration" },
        { key: "type", label: "Type", type: "select", options: [
          { value: "truck", label: "Truck" },
          { value: "trailer", label: "Trailer" },
          { value: "prime_mover", label: "Prime mover" },
        ]},
        { key: "make", label: "Make", optional: true },
        { key: "model", label: "Model", optional: true },
        { key: "capacity_tons", label: "Capacity (tons)", type: "number", optional: true },
        { key: "container_slots", label: "Container slots", type: "number" },
        { key: "ownership", label: "Ownership", type: "select", options: [
          { value: "own", label: "Owned" }, { value: "leased", label: "Leased" }
        ]},
        { key: "carrier_id", label: "Carrier", type: "select", optional: true,
          options: (carriers ?? []).map((c: any) => ({ value: c.id, label: c.name })) },
        { key: "status", label: "Status", type: "select", options: [
          { value: "available", label: "Available" },
          { value: "on_trip", label: "On trip" },
          { value: "maintenance", label: "Maintenance" },
          { value: "retired", label: "Retired" },
        ]},
        { key: "odometer", label: "Odometer", type: "number" },
        { key: "insurance_expiry", label: "Insurance expiry", type: "date", optional: true },
        { key: "notes", label: "Notes", span: 2, optional: true },
      ]}
      columns={[
        { key: "registration", label: "Reg" },
        { key: "type", label: "Type" },
        { key: "make", label: "Make/Model", render: (r: any) => [r.make, r.model].filter(Boolean).join(" ") || "—" },
        { key: "capacity_tons", label: "Capacity" },
        { key: "ownership", label: "Owned" },
        { key: "status", label: "Status", render: (r: any) => <StatusBadge value={r.status} tone={r.status === "available" ? "default" : r.status === "on_trip" ? "outline" : "destructive"} /> },
      ]}
    />
  );
}
