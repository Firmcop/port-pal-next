import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { useAppSettings } from "@/hooks/use-app-settings";
import { setAppSettings } from "@/lib/app-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

/**
 * Org-wide defaults for the two acquisition service vendors. Container intake
 * pre-fills these; any deviation is logged as an override on the container.
 */
export default function AcquisitionDefaultsSection() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { acquisitionDefaults } = useAppSettings();

  const [transportVendor, setTransportVendor] = useState(acquisitionDefaults.transportVendor);
  const [transportCost, setTransportCost] = useState(acquisitionDefaults.transportCost?.toString() ?? "");
  const [offloadingVendor, setOffloadingVendor] = useState(acquisitionDefaults.offloadingVendor);
  const [offloadingCost, setOffloadingCost] = useState(acquisitionDefaults.offloadingCost?.toString() ?? "");
  const [rate20, setRate20] = useState(acquisitionDefaults.transportRate20?.toString() ?? "");
  const [rate40, setRate40] = useState(acquisitionDefaults.transportRate40?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTransportVendor(acquisitionDefaults.transportVendor);
    setTransportCost(acquisitionDefaults.transportCost?.toString() ?? "");
    setOffloadingVendor(acquisitionDefaults.offloadingVendor);
    setOffloadingCost(acquisitionDefaults.offloadingCost?.toString() ?? "");
    setRate20(acquisitionDefaults.transportRate20?.toString() ?? "");
    setRate40(acquisitionDefaults.transportRate40?.toString() ?? "");
  }, [acquisitionDefaults]);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-acq-defaults"],
    queryFn: async () =>
      (await supabase.from("suppliers").select("id,name").eq("is_active", true).order("name")).data ?? [],
  });

  const save = async () => {
    if (!org.organizationId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("organizations")
        .select("config")
        .eq("id", org.organizationId)
        .maybeSingle();
      if (error) throw error;
      const acquisition_defaults = {
        transport_vendor: transportVendor.trim(),
        transport_cost: Number(transportCost) > 0 ? Number(transportCost) : null,
        offloading_vendor: offloadingVendor.trim(),
        offloading_cost: Number(offloadingCost) > 0 ? Number(offloadingCost) : null,
        transport_rate_20: Number(rate20) > 0 ? Number(rate20) : null,
        transport_rate_40: Number(rate40) > 0 ? Number(rate40) : null,
      };
      const config = { ...((data?.config as any) ?? {}), acquisition_defaults };
      const { error: upErr } = await supabase.from("organizations").update({ config }).eq("id", org.organizationId);
      if (upErr) throw upErr;
      setAppSettings({
        acquisitionDefaults: {
          transportVendor: acquisition_defaults.transport_vendor,
          transportCost: acquisition_defaults.transport_cost,
          offloadingVendor: acquisition_defaults.offloading_vendor,
          offloadingCost: acquisition_defaults.offloading_cost,
          transportRate20: acquisition_defaults.transport_rate_20,
          transportRate40: acquisition_defaults.transport_rate_40,
        },
      });
      qc.invalidateQueries({ queryKey: ["app-settings-org", org.organizationId] });
      toast.success("Acquisition defaults saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save acquisition defaults");
    } finally {
      setSaving(false);
    }
  };

  const vendorField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    cost: string,
    onCost: (v: string) => void,
  ) => (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-xs">{label}</Label>
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
          <SelectContent>
            {(suppliers ?? []).map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="…or type vendor name" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Default cost (optional)</Label>
        <Input type="number" step="0.01" min="0" value={cost} onChange={(e) => onCost(e.target.value)} placeholder="0.00" />
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Container acquisition defaults</CardTitle>
        <CardDescription>
          Pre-filled on every container intake. Staff can override the vendor or amount per container — every override
          is recorded in the finance audit trail.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {vendorField("Default transporter", transportVendor, setTransportVendor, transportCost, setTransportCost)}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Standard transport rate — 20ft</Label>
            <Input type="number" step="0.01" min="0" value={rate20} onChange={(e) => setRate20(e.target.value)} placeholder="32500" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Standard transport rate — 40ft / 45ft</Label>
            <Input type="number" step="0.01" min="0" value={rate40} onChange={(e) => setRate40(e.target.value)} placeholder="40000" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Container intake pre-fills the transport cost from the size-matched rate above.
        </p>
        {vendorField("Default crane / offloading vendor", offloadingVendor, setOffloadingVendor, offloadingCost, setOffloadingCost)}
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving}>
            <Save className="h-3.5 w-3.5 me-1.5" />{saving ? "Saving…" : "Save defaults"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
