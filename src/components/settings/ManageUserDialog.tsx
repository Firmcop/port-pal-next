import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import { STAFF_ROLES, ROLE_LABELS, type StaffRoleCode } from "@/lib/staff-roles";
import { Loader2, KeyRound, Mail, LogOut, Trash2, Shield, UserCog } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  displayName: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CloneableJsonResponse = { clone: () => { json: () => Promise<unknown> } };

function hasCloneableJsonResponse(value: unknown): value is CloneableJsonResponse {
  return typeof value === "object" && value !== null && typeof (value as { clone?: unknown }).clone === "function";
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

function isStaffRole(role: string | null | undefined): role is StaffRoleCode {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

function adminUpdateBody(organizationId: string | null, body: Record<string, unknown>) {
  const org = typeof organizationId === "string" ? organizationId.trim() : "";
  return org && UUID_RE.test(org) ? { ...body, organization_id: org } : body;
}

async function invokeAdminUpdateUser(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("admin-update-user", { body });
  if (error) {
    const response = (error as { context?: unknown }).context;
    if (hasCloneableJsonResponse(response)) {
      let backendMessage: string | undefined;
      try {
        const payload = await response.clone().json();
        const payloadError = typeof payload === "object" && payload !== null ? (payload as { error?: unknown }).error : undefined;
        backendMessage = typeof payloadError === "string" ? payloadError : undefined;
      } catch {
        backendMessage = undefined;
      }
      if (backendMessage) throw new Error(backendMessage);
    }
    throw error;
  }
  const result = data as { error?: unknown } | null;
  if (typeof result?.error === "string") throw new Error(result.error);
  return data;
}

export default function ManageUserDialog({ open, onOpenChange, userId, displayName }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { organizationId } = useOrganization();

  const [name, setName] = useState(displayName ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  // Load profile + email
  const { data: profile } = useQuery({
    queryKey: ["manage-user", userId],
    enabled: open && !!userId,
    queryFn: async () => {
      const { data: p } = await supabase.from("profiles").select("display_name, phone").eq("user_id", userId).maybeSingle();
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      return { profile: p, roles: (roles ?? []).map((r: { role: string | null }) => r.role) };
    },
  });

  useEffect(() => {
    if (profile?.profile) {
      setName(profile.profile.display_name ?? "");
      setPhone(profile.profile.phone ?? "");
    }
  }, [profile]);

  useEffect(() => {
    if (!open) {
      setEmail(""); setNewPassword(""); setDeleteText("");
    }
  }, [open]);

  const currentRoles = (profile?.roles ?? []).filter(isStaffRole);
  const effective: StaffRoleCode[] = currentRoles.length ? currentRoles : ["viewer"];

  const saveProfile = useMutation({
    mutationFn: async () => {
      await invokeAdminUpdateUser(adminUpdateBody(organizationId, { userId, displayName: name, phone }));
    },
    onSuccess: () => { toast({ title: "Profile updated" }); qc.invalidateQueries({ queryKey: ["profiles-with-roles"] }); },
    onError: (e: unknown) => toast({ title: "Failed", description: errorText(e), variant: "destructive" }),
  });

  const updateEmail = useMutation({
    mutationFn: async () => {
      if (!email) throw new Error("Enter a new email");
      await invokeAdminUpdateUser(adminUpdateBody(organizationId, { userId, email }));
    },
    onSuccess: () => { toast({ title: "Email updated" }); setEmail(""); },
    onError: (e: unknown) => toast({ title: "Failed", description: errorText(e), variant: "destructive" }),
  });

  const setPassword = useMutation({
    mutationFn: async () => {
      if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
      await invokeAdminUpdateUser(adminUpdateBody(organizationId, { userId, password: newPassword, signOutAll: true }));
    },
    onSuccess: () => { toast({ title: "Password updated, user signed out everywhere" }); setNewPassword(""); },
    onError: (e: unknown) => toast({ title: "Failed", description: errorText(e), variant: "destructive" }),
  });

  const signOutAll = useMutation({
    mutationFn: async () => {
      await invokeAdminUpdateUser(adminUpdateBody(organizationId, { userId, signOutAll: true }));
    },
    onSuccess: () => toast({ title: "User signed out from all sessions" }),
    onError: (e: unknown) => toast({ title: "Failed", description: errorText(e), variant: "destructive" }),
  });

  const setRoles = useMutation({
    mutationFn: async (roles: StaffRoleCode[]) => {
      const { error } = await supabase.rpc("set_user_staff_roles", {
        _target_user_id: userId,
        _roles: roles,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["user-roles-all"] }); qc.invalidateQueries({ queryKey: ["manage-user", userId] }); toast({ title: "Roles updated" }); },
    onError: (e: unknown) => toast({ title: "Failed", description: errorText(e), variant: "destructive" }),
  });

  const deleteUser = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-delete-user", {
        body: { userId, organization_id: organizationId, hardDelete: true },
      });
      if (error) throw error;
      const result = data as { error?: unknown } | null;
      if (typeof result?.error === "string") throw new Error(result.error);
    },
    onSuccess: () => {
      toast({ title: "User removed" });
      qc.invalidateQueries({ queryKey: ["profiles-with-roles"] });
      qc.invalidateQueries({ queryKey: ["user-roles-all"] });
      setConfirmDelete(false);
      onOpenChange(false);
    },
    onError: (e: unknown) => toast({ title: "Failed", description: errorText(e), variant: "destructive" }),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserCog className="h-4 w-4" />Manage {displayName || "user"}</DialogTitle>
            <DialogDescription>Update profile, security credentials, roles, and membership.</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="profile">
            <TabsList>
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="roles">Roles</TabsTrigger>
              <TabsTrigger value="danger" className="text-destructive">Danger zone</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="space-y-3 pt-4">
              <div className="space-y-1.5">
                <Label>Display name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <Button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
                {saveProfile.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save profile
              </Button>
            </TabsContent>

            <TabsContent value="security" className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />Change email</Label>
                <div className="flex gap-2">
                  <Input type="email" placeholder="new@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <Button variant="outline" onClick={() => updateEmail.mutate()} disabled={updateEmail.isPending || !email}>
                    {updateEmail.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Update
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Sets and confirms the new email immediately.</p>
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" />Set new password</Label>
                <div className="flex gap-2">
                  <Input type="text" placeholder="At least 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                  <Button variant="outline" onClick={() => setPassword.mutate()} disabled={setPassword.isPending || newPassword.length < 8}>
                    {setPassword.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Set
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">User will be signed out from all sessions.</p>
              </div>

              <Separator />

              <Button variant="outline" onClick={() => signOutAll.mutate()} disabled={signOutAll.isPending}>
                {signOutAll.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogOut className="h-4 w-4 mr-2" />}
                Sign user out of all sessions
              </Button>
            </TabsContent>

            <TabsContent value="roles" className="space-y-2 pt-4">
              <Label className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" />Assigned roles</Label>
              <div className="grid grid-cols-2 gap-2 max-h-[320px] overflow-auto border rounded-md p-3">
                {STAFF_ROLES.map((r) => {
                  const checked = effective.includes(r);
                  return (
                    <label key={r} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          const next = v ? Array.from(new Set([...effective, r])) : effective.filter((x) => x !== r);
                          if (next.length === 0) { toast({ title: "At least one role required", variant: "destructive" }); return; }
                          setRoles.mutate(next);
                        }}
                      />
                      {ROLE_LABELS[r]}
                    </label>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="danger" className="space-y-3 pt-4">
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 space-y-3">
                <div>
                  <h4 className="font-semibold text-sm flex items-center gap-1.5"><Trash2 className="h-4 w-4" />Delete user</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Removes the user from this organization. If they have no other organizations, their account is deleted entirely.
                  </p>
                </div>
                <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                  Delete user
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {displayName || "this user"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Type <span className="font-mono font-semibold">DELETE</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="DELETE" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteText !== "DELETE" || deleteUser.isPending}
              onClick={(e) => { e.preventDefault(); deleteUser.mutate(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteUser.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
