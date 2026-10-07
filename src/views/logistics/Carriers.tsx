import { useQuery } from "@tanstack/react-query";
import { getDefaultCurrency } from "@/lib/finance-format";
import { supabase } from "@/integrations/supabase/client";
import { SimpleRegistry, StatusBadge } from "@/components/logistics/SimpleRegistry";
import { Building } from "lucide-react";

export default function LogisticsCarriers() {
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-pick"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("id,name").order("name");
      return data ?? [];
    },
  });

  return (
    <SimpleRegistry
      title="Carriers"
      icon={<Building className="h-6 w-6" />}
      table="logistics_carriers"
      searchField="name"
      defaultForm={{ name: "", type: "internal", contact_name: "", contact_phone: "", contact_email: "", default_currency: getDefaultCurrency(), supplier_id: "", notes: "", is_active: true }}
      fields={[
        { key: "name", label: "Name", span: 2 },
        { key: "type", label: "Type", type: "select", options: [
          { value: "internal", label: "Internal fleet" },
          { value: "subcontractor", label: "Subcontractor" },
        ]},
        { key: "default_currency", label: "Currency" },
        { key: "supplier_id", label: "Linked supplier", type: "select", optional: true,
          options: (suppliers ?? []).map((s: any) => ({ value: s.id, label: s.name })) },
        { key: "contact_name", label: "Contact name", optional: true },
        { key: "contact_phone", label: "Contact phone", optional: true },
        { key: "contact_email", label: "Contact email", optional: true },
        { key: "notes", label: "Notes", span: 2, optional: true },
      ]}
      columns={[
        { key: "name", label: "Name" },
        { key: "type", label: "Type", render: (r: any) => <StatusBadge value={r.type} tone={r.type === "internal" ? "default" : "outline"} /> },
        { key: "contact_phone", label: "Phone" },
        { key: "default_currency", label: "Currency" },
        { key: "is_active", label: "Active", render: (r: any) => r.is_active ? "Yes" : "No" },
      ]}
    />
  );
}
