import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  useOrganization,
  getStoredActiveOrgId,
  setStoredActiveOrgId,
} from "@/hooks/use-organization";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2 } from "lucide-react";

type OrgOption = { id: string; name: string; is_member: boolean };

export function TenantSwitcher() {
  const { user } = useAuth();
  const { organizationId, isPlatformAdmin, loading } = useOrganization();
  const qc = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(getStoredActiveOrgId());

  const { data: options = [] } = useQuery({
    queryKey: ["tenant-switcher-options", user?.id, isPlatformAdmin],
    enabled: !!user,
    queryFn: async (): Promise<OrgOption[]> => {
      // Memberships this user has (always allowed).
      const { data: mems } = await supabase
        .from("organization_members")
        .select("organization_id, organizations(id, name)")
        .eq("user_id", user!.id)
        .eq("status", "active");
      const memberOrgs: OrgOption[] = (mems ?? [])
        .map((m: any) => m.organizations)
        .filter(Boolean)
        .map((o: any) => ({ id: o.id, name: o.name, is_member: true }));

      if (!isPlatformAdmin) return memberOrgs;

      // Platform admins can pin any organization.
      const { data: all } = await supabase
        .from("organizations")
        .select("id, name")
        .order("name");
      const memberIds = new Set(memberOrgs.map((o) => o.id));
      const extras: OrgOption[] = (all ?? [])
        .filter((o: any) => !memberIds.has(o.id))
        .map((o: any) => ({ id: o.id, name: o.name, is_member: false }));
      return [...memberOrgs, ...extras];
    },
  });

  const activeId = pendingId ?? organizationId ?? "";

  // Keep the local state aligned with whatever resolved as active.
  useEffect(() => {
    if (!pendingId && organizationId) setPendingId(organizationId);
  }, [organizationId, pendingId]);

  const onChange = (id: string) => {
    setPendingId(id);
    setStoredActiveOrgId(id);
    // Nuke all caches so every query re-fetches under the new tenant.
    qc.clear();
  };

  // Hide the switcher entirely when there's nothing to switch to.
  const showable = useMemo(() => options.length > 1, [options]);
  if (loading || !showable) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
      <Select value={activeId} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[220px]">
          <SelectValue placeholder="Select organization" />
        </SelectTrigger>
        <SelectContent align="end">
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
              {!o.is_member && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  admin
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
