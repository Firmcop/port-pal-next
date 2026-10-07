import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Container } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { EmailVerificationStatus } from "@/components/auth/EmailVerificationStatus";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function Login() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const { signIn, signUp } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation(["auth", "common"]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isSignUp) {
        await signUp(email, password, displayName);
        setVerificationSent(true);
      } else {
        await signIn(email, password);
      }
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
          <div className="flex justify-end">
            <LanguageSwitcher className="h-8 w-[140px] text-xs" />
          </div>
          <div className="flex justify-center">
            <div className="h-14 w-14 rounded-xl bg-primary flex items-center justify-center">
              <Container className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">
            {verificationSent
              ? t("common:app_name")
              : isSignUp
              ? t("auth:create_workspace_title")
              : t("common:app_name")}
          </CardTitle>
          <CardDescription>
            {verificationSent
              ? t("auth:verify_subtitle")
              : isSignUp
              ? t("auth:create_workspace_subtitle")
              : t("auth:sign_in_subtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {verificationSent ? (
            <div className="space-y-4">
              <EmailVerificationStatus email={email} verified={false} />
              <button
                onClick={() => { setVerificationSent(false); setIsSignUp(false); setPassword(""); }}
                className="block w-full text-center text-sm text-primary hover:underline"
              >
                {t("auth:back_to_sign_in")}
              </button>
            </div>
          ) : (
            <>
              {isSignUp && (
                <div className="mb-4 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1.5">
                  <p className="font-medium text-foreground">{t("auth:workspace_perks_title")}</p>
                  <p>✓ {t("auth:workspace_perk_isolated")}</p>
                  <p>✓ {t("auth:workspace_perk_trial")}</p>
                  <p>✓ {t("auth:workspace_perk_owner")}</p>
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                {isSignUp && (
                  <Input placeholder={t("auth:display_name")} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                )}
                <Input type="email" placeholder={t("auth:email")} value={email} onChange={(e) => setEmail(e.target.value)} required />
                <Input type="password" placeholder={t("auth:password")} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
                {!isSignUp && (
                  <div className="text-right -mt-2">
                    <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                      {t("auth:forgot_password_link")}
                    </Link>
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? t("auth:please_wait") : isSignUp ? t("auth:create_workspace_cta") : t("auth:sign_in")}
                </Button>
              </form>
              <div className="mt-4 text-center text-sm text-muted-foreground">
                {isSignUp ? t("auth:have_account") : t("auth:no_account")}{" "}
                <button onClick={() => setIsSignUp(!isSignUp)} className="text-primary font-medium hover:underline">
                  {isSignUp ? t("auth:sign_in") : t("auth:create_workspace_link")}
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
