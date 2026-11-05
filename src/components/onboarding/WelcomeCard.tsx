import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useOrganization } from "@/hooks/use-organization";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, Users, Warehouse, DoorOpen, X, ArrowRight } from "lucide-react";

const FIRST_STEPS = [
  { to: "/settings", icon: Building2, title: "Company details", text: "Logo, KRA PIN and how your documents look" },
  { to: "/yard-map", icon: Warehouse, title: "Depot & yard", text: "Yard blocks and where containers stand" },
  { to: "/users", icon: Users, title: "Invite your team", text: "Gate clerks, accountants, managers" },
  { to: "/gate/eir", icon: DoorOpen, title: "First gate-in", text: "Record a container coming in" },
];

/** First thing a new company sees on the dashboard during its trial. Dismissible per company. */
export function WelcomeCard() {
  const { user } = useAuth();
  const org = useOrganization();
  const key = `welcome_dismissed_${org.organizationId}`;
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  });
  if (org.loading || !org.organizationId || org.status !== "trial" || hidden) return null;

  const name = (user?.user_metadata as any)?.display_name?.split(" ")[0];
  const ends = org.trialEndsAt ? new Date(org.trialEndsAt).toLocaleDateString(undefined, { day: "numeric", month: "long" }) : null;
  const dismiss = () => {
    try { localStorage.setItem(key, "1"); } catch { /* private mode */ }
    setHidden(true);
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{name ? `Welcome to Port Pal, ${name}` : "Welcome to Port Pal"}</h2>
            <p className="text-sm text-muted-foreground">
              {org.organizationName} is ready{ends ? ` — your free trial runs until ${ends}` : ""}. Four steps get you going:
            </p>
          </div>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={dismiss} aria-label="Hide welcome">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {FIRST_STEPS.map((s) => (
            <Link key={s.to} to={s.to} className="group rounded-lg border bg-card p-3 hover:border-primary/50 transition-colors">
              <div className="flex items-center gap-2 font-medium text-sm">
                <s.icon className="h-4 w-4 text-primary" /> {s.title}
                <ArrowRight className="ms-auto h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">{s.text}</p>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
