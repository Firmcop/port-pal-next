import { useEffect, useState } from "react";
import { Link, useNavigate } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Container } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation(["auth"]);
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash || "";
    const hasRecovery = hash.includes("type=recovery");

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && hasRecovery)) {
        setReady(true);
      }
    });

    // Fallback: if we have a session and recovery hash, mark ready
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && hasRecovery) setReady(true);
      else if (!hasRecovery && !session) setInvalid(true);
    });

    // Give the auth event a moment, then decide
    const timer = setTimeout(() => {
      if (!hasRecovery) setInvalid(true);
    }, 1500);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: t("auth:error"), description: t("auth:passwords_dont_match"), variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({ title: t("auth:reset_password_success") });
      await supabase.auth.signOut();
      navigate("/login", { replace: true });
    } catch (err: any) {
      toast({ title: t("auth:error"), description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-14 w-14 rounded-xl bg-primary flex items-center justify-center">
              <Container className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">{t("auth:reset_password_title")}</CardTitle>
          <CardDescription>{t("auth:reset_password_subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {invalid && !ready ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">{t("auth:reset_link_invalid")}</p>
              <Link to="/forgot-password" className="block text-sm text-primary hover:underline">
                {t("auth:forgot_password_link")}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="password"
                placeholder={t("auth:new_password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
              <Input
                type="password"
                placeholder={t("auth:confirm_password")}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
              />
              <Button type="submit" className="w-full" disabled={loading || !ready}>
                {loading ? t("auth:please_wait") : t("auth:reset_password_cta")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
