import { Navigate } from "@/lib/router";
import { useUserDirectoryAccess } from "@/hooks/use-user-directory-access";
import UserRolesSection from "@/components/settings/UserRolesSection";
import UserPermissionOverrides from "@/components/settings/UserPermissionOverrides";
import { Card, CardContent } from "@/components/ui/card";
import { Users, Lock } from "lucide-react";

export default function UsersDirectory() {
  const { loading, canOpen, canManage } = useUserDirectoryAccess();

  if (loading) {
    return <div className="min-h-[40vh] flex items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!canOpen) return <Navigate to="/" replace />;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="h-5 w-5" /> Users
          </h1>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "Manage teammates, roles, and invitations for your organization."
              : "Read-only directory of teammates in your area. Contact an admin to change roles or invite users."}
          </p>
        </div>
        {!canManage && (
          <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground border rounded-md px-2 py-1">
            <Lock className="h-3 w-3" /> Read-only
          </div>
        )}
      </div>
      <Card>
        <CardContent className="pt-6">
          <UserRolesSection />
        </CardContent>
      </Card>
      {canManage && <UserPermissionOverrides />}
    </div>
  );
}
