import { useState } from "react";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Container, MailCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation(["auth"]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
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
              {sent ? (
                <MailCheck className="h-8 w-8 text-primary-foreground" />
              ) : (
                <Container className="h-8 w-8 text-primary-foreground" />
              )}
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">
            {sent ? t("auth:forgot_password_sent_title") : t("auth:forgot_password_title")}
          </CardTitle>
          <CardDescription>
            {sent ? t("auth:forgot_password_sent_body") : t("auth:forgot_password_subtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <Link to="/login" className="block w-full text-center text-sm text-primary hover:underline">
              {t("auth:back_to_sign_in")}
            </Link>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  type="email"
                  placeholder={t("auth:email")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Button type="submit" className="w-full" disabled={loading || !email}>
                  {loading ? t("auth:please_wait") : t("auth:forgot_password_cta")}
                </Button>
              </form>
              <div className="mt-4 text-center text-sm">
                <Link to="/login" className="text-primary hover:underline">
                  {t("auth:back_to_sign_in")}
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
