import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Mail, LogOut, Loader2, UserCircle2 } from "lucide-react";

export default function AccountSecurityCard() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");

  const { data: profile } = useQuery({
    queryKey: ["my-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("display_name, phone").eq("user_id", user!.id).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (profile) { setName(profile.display_name ?? ""); setPhone(profile.phone ?? ""); }
  }, [profile]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("profiles").update({ display_name: name, phone }).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Profile saved" }); qc.invalidateQueries({ queryKey: ["my-profile", user?.id] }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const changeEmail = useMutation({
    mutationFn: async () => {
      if (!newEmail) throw new Error("Enter an email");
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Check both inboxes to confirm the change" }); setNewEmail(""); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      if (newPw.length < 8) throw new Error("Password must be at least 8 characters");
      // Re-auth with current password
      const { error: reauth } = await supabase.auth.signInWithPassword({
        email: user!.email!, password: currentPw,
      });
      if (reauth) throw new Error("Current password is incorrect");
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Password updated" }); setCurrentPw(""); setNewPw(""); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const signOutEverywhere = async () => {
    await supabase.auth.signOut({ scope: "global" } as any);
    toast({ title: "Signed out everywhere" });
    await signOut();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><UserCircle2 className="h-4 w-4" />Your account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Display name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <Button size="sm" onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
          {saveProfile.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save profile
        </Button>

        <Separator />

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />Change email</Label>
          <div className="flex gap-2 max-w-md">
            <Input type="email" placeholder={user?.email ?? ""} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <Button variant="outline" onClick={() => changeEmail.mutate()} disabled={changeEmail.isPending || !newEmail}>
              {changeEmail.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Update
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">A confirmation link is sent to both addresses.</p>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" />Change password</Label>
          <div className="grid sm:grid-cols-2 gap-2 max-w-xl">
            <Input type="password" placeholder="Current password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" />
            <Input type="password" placeholder="New password (min 8)" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
          </div>
          <Button size="sm" variant="outline" onClick={() => changePassword.mutate()} disabled={changePassword.isPending || !currentPw || newPw.length < 8}>
            {changePassword.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Update password
          </Button>
        </div>

        <Separator />

        <Button size="sm" variant="outline" onClick={signOutEverywhere}>
          <LogOut className="h-4 w-4 mr-2" />Sign out of all sessions
        </Button>
      </CardContent>
    </Card>
  );
}
