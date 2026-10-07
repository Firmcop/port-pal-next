import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SimpleRegistry } from "@/components/logistics/SimpleRegistry";
import { Users } from "lucide-react";

export default function LogisticsDrivers() {
  const { data: carriers } = useQuery({
    queryKey: ["logistics-carriers-pick"],
    queryFn: async () => (await supabase.from("logistics_carriers").select("id,name").order("name")).data ?? [],
  });

  return (
    <SimpleRegistry
      title="Drivers"
      icon={<Users className="h-6 w-6" />}
      table="logistics_drivers"
      searchField="name"
      defaultForm={{ name: "", phone: "", license_no: "", license_expiry: "", carrier_id: "", status: "available", notes: "", is_active: true }}
      fields={[
        { key: "name", label: "Name", span: 2 },
        { key: "phone", label: "Phone" },
        { key: "license_no", label: "License #" },
        { key: "license_expiry", label: "License expiry", type: "date", optional: true },
        { key: "carrier_id", label: "Carrier", type: "select", optional: true,
          options: (carriers ?? []).map((c: any) => ({ value: c.id, label: c.name })) },
        { key: "status", label: "Status", type: "select", options: [
          { value: "available", label: "Available" },
          { value: "on_trip", label: "On trip" },
          { value: "off_duty", label: "Off duty" },
        ]},
        { key: "notes", label: "Notes", span: 2, optional: true },
      ]}
      columns={[
        { key: "name", label: "Name" },
        { key: "phone", label: "Phone" },
        { key: "license_no", label: "License" },
        { key: "license_expiry", label: "Expiry" },
        { key: "status", label: "Status" },
      ]}
    />
  );
}
