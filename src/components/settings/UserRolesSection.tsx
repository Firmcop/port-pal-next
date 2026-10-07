import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Users, Lock, UserPlus, Mail, RotateCcw, X, KeyRound, MoreVertical, Shield, ChevronDown, UserCog } from "lucide-react";
import ManageUserDialog from "./ManageUserDialog";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import { useUserDirectoryAccess } from "@/hooks/use-user-directory-access";
import { format } from "date-fns";
import InviteWizard from "./InviteWizard";
import RoleRightsEditor from "./RoleRightsEditor";
import BulkIssueCredentialsDialog from "./BulkIssueCredentialsDialog";
import { STAFF_ROLES, ROLE_LABELS } from "@/lib/staff-roles";

export default function UserRolesSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { canManage, visibleRoles } = useUserDirectoryAccess();
  const isOwnerOrAdmin = canManage; // legacy alias used below
  const org = useOrganization();
  const { organizationId } = org;
  const canBulkReset = org.isPlatformAdmin || org.role === "org_owner" || org.role === "admin";
  const [wizard, setWizard] = useState<{ open: boolean; mode: "invite" | "direct" }>({ open: false, mode: "invite" });
  const [rightsFor, setRightsFor] = useState<{ roles: string[]; name: string } | null>(null);
  const [manageUser, setManageUser] = useState<{ userId: string; name: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["profiles-with-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, user_id, display_name").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: userRoles } = useQuery({
    queryKey: ["user-roles-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("id, user_id, role");
      if (error) throw error;
      return data;
    },
  });

  const { data: invitations } = useQuery({
    queryKey: ["staff-invitations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_invitations")
        .select("id, email, role, expires_at, accepted_at, revoked_at, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const allRolesMap = new Map<string, string[]>();
  userRoles?.forEach((ur: any) => {
    const list = allRolesMap.get(ur.user_id) ?? [];
    list.push(ur.role);
    allRolesMap.set(ur.user_id, list);
  });

  const setRoles = useMutation({
    mutationFn: async ({ userId, roles }: { userId: string; roles: string[] }) => {
      const { error } = await supabase.rpc("set_user_staff_roles", {
        _target_user_id: userId,
        _roles: roles as any,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["user-roles-all"] }); toast({ title: "Roles updated" }); },
    onError: (e: any) => toast({ title: "Could not update roles", description: e.message, variant: "destructive" }),
  });

  const invite = useMutation({
    mutationFn: async ({ mode, payload }: { mode: "resend" | "revoke"; payload?: any }) => {
      const { data, error } = await supabase.functions.invoke("invite-staff-user", { body: { mode, ...(payload ?? {}) } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["staff-invitations"] }); },
    onError: (e: any) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const pending = (invitations ?? []).filter((i: any) => !i.accepted_at && !i.revoked_at);

  // Apply directory-scope filter for read-only manager viewers.
  const visibleProfiles = (profiles ?? []).filter((p: any) => {
    if (visibleRoles == null) return true; // unrestricted
    const roles = allRolesMap.get(p.user_id) ?? [];
    return roles.some((r) => visibleRoles.includes(r));
  });
  const hasUsers = visibleProfiles.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />Users & Roles</CardTitle>
            {!isOwnerOrAdmin && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                <Lock className="h-3 w-3" /> Only admins or organization owners can change roles.
              </p>
            )}
          </div>
          {isOwnerOrAdmin && (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {canBulkReset && (
                <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
                  <KeyRound className="h-4 w-4 mr-1.5" />Issue credentials
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setWizard({ open: true, mode: "direct" })}>
                <KeyRound className="h-4 w-4 mr-1.5" />Add user directly
              </Button>
              <Button size="sm" onClick={() => setWizard({ open: true, mode: "invite" })}>
                <UserPlus className="h-4 w-4 mr-1.5" />Invite teammate
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {!hasUsers && !isLoading && isOwnerOrAdmin ? (
            <div className="text-center py-12 px-4 space-y-3">
              <Users className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No teammates yet.</p>
              <Button size="sm" onClick={() => setWizard({ open: true, mode: "invite" })}>
                <UserPlus className="h-4 w-4 mr-1.5" />Invite your first teammate
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Roles</TableHead>
                  {isOwnerOrAdmin && <TableHead className="w-[60px]"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : visibleProfiles.map((p: any) => {
                  const userAllRoles = allRolesMap.get(p.user_id) ?? [];
                  const staffRoles = userAllRoles.filter((r) => (STAFF_ROLES as readonly string[]).includes(r));
                  const isPortal = userAllRoles.includes("customer");
                  const effective = staffRoles.length ? staffRoles : ["viewer"];
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">{p.display_name || "Unnamed"}{isPortal && <Badge variant="secondary" className="text-[10px]">Portal</Badge>}</div>
                      </TableCell>
                      <TableCell>
                        {isOwnerOrAdmin ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className="h-auto min-h-9 py-1 px-2 max-w-[360px] justify-start">
                                <div className="flex flex-wrap gap-1 items-center">
                                  {effective.map((r) => (
                                    <Badge key={r} variant="secondary" className="text-[10px]">{ROLE_LABELS[r] ?? r}</Badge>
                                  ))}
                                </div>
                                <ChevronDown className="h-3 w-3 ml-1 shrink-0 opacity-60" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-64 p-2">
                              <div className="text-xs font-semibold mb-2 px-1">Assign roles</div>
                              <div className="space-y-1 max-h-[300px] overflow-auto">
                                {STAFF_ROLES.map((r) => {
                                  const checked = effective.includes(r);
                                  return (
                                    <label key={r} className="flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-muted cursor-pointer">
                                      <Checkbox
                                        checked={checked}
                                        onCheckedChange={(v) => {
                                          const next = v
                                            ? Array.from(new Set([...effective, r]))
                                            : effective.filter((x) => x !== r);
                                          if (next.length === 0) {
                                            toast({ title: "At least one role required", variant: "destructive" });
                                            return;
                                          }
                                          setRoles.mutate({ userId: p.user_id, roles: next });
                                        }}
                                      />
                                      {ROLE_LABELS[r]}
                                    </label>
                                  );
                                })}
                              </div>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {effective.map((r) => <Badge key={r} variant="outline">{ROLE_LABELS[r]}</Badge>)}
                          </div>
                        )}
                      </TableCell>
                      {isOwnerOrAdmin && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setManageUser({ userId: p.user_id, name: p.display_name || "Unnamed" })}>
                                <UserCog className="h-4 w-4 mr-2" />Manage user…
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setRightsFor({ roles: effective, name: p.display_name || "Unnamed" })}>
                                <Shield className="h-4 w-4 mr-2" />Manage rights for these roles
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={async () => {
                                  if (!organizationId) return;
                                  const { error } = await supabase
                                    .from("organization_members")
                                    .update({ status: "suspended" })
                                    .eq("organization_id", organizationId)
                                    .eq("user_id", p.user_id);
                                  if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
                                  else {
                                    toast({ title: "User removed from organization" });
                                    qc.invalidateQueries({ queryKey: ["profiles-with-roles"] });
                                  }
                                }}
                              >
                                <X className="h-4 w-4 mr-2" />Remove from organization
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isOwnerOrAdmin && pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />Pending invitations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Expires</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {pending.map((i: any) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.email}</TableCell>
                    <TableCell><Badge variant="outline">{ROLE_LABELS[i.role] ?? i.role}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(i.expires_at), "PP")}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" disabled={invite.isPending} onClick={async () => { await invite.mutateAsync({ mode: "resend", payload: { invitationId: i.id } }); toast({ title: "Invitation resent" }); }}>
                        <RotateCcw className="h-3 w-3 mr-1" />Resend
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={invite.isPending} onClick={async () => { await invite.mutateAsync({ mode: "revoke", payload: { invitationId: i.id } }); toast({ title: "Invitation revoked" }); }}>
                        <X className="h-3 w-3 mr-1" />Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <InviteWizard
        open={wizard.open}
        mode={wizard.mode}
        onOpenChange={(v) => setWizard((w) => ({ ...w, open: v }))}
      />

      <Dialog open={!!rightsFor} onOpenChange={(v) => !v && setRightsFor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Rights for {rightsFor?.name}
            </DialogTitle>
          </DialogHeader>
          {rightsFor && (
            rightsFor.roles.length === 1 ? (
              <RoleRightsEditor role={rightsFor.roles[0]} organizationId={organizationId} livePersist />
            ) : (
              <Tabs defaultValue={rightsFor.roles[0]}>
                <TabsList className="flex flex-wrap h-auto">
                  {rightsFor.roles.map((r) => <TabsTrigger key={r} value={r}>{ROLE_LABELS[r]}</TabsTrigger>)}
                </TabsList>
                {rightsFor.roles.map((r) => (
                  <TabsContent key={r} value={r}>
                    <RoleRightsEditor role={r} organizationId={organizationId} livePersist />
                  </TabsContent>
                ))}
              </Tabs>
            )
          )}
          <DialogFooter>
            <Button onClick={() => setRightsFor(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {manageUser && (
        <ManageUserDialog
          open={!!manageUser}
          onOpenChange={(v) => !v && setManageUser(null)}
          userId={manageUser.userId}
          displayName={manageUser.name}
        />
      )}

      <BulkIssueCredentialsDialog open={bulkOpen} onOpenChange={setBulkOpen} />
    </div>
  );
}
