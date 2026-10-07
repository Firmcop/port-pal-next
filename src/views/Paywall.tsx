import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Mail, Settings } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Link } from "@/lib/router";

export default function Paywall() {
  const org = useOrganization();
  const { signOut } = useAuth();

  const labels: Record<string, { title: string; desc: string }> = {
    trial_expired: {
      title: "Your trial has ended",
      desc: "Pick a plan to continue using CDMS. Your data is safe — nothing has been deleted.",
    },
    past_due: {
      title: "Payment overdue",
      desc: "Your subscription is past due. Settle the latest invoice to restore full access.",
    },
    suspended: {
      title: "Account suspended",
      desc: "Access has been suspended due to non-payment. Contact your account manager.",
    },
    cancelled: {
      title: "Subscription cancelled",
      desc: "Your subscription was cancelled. Reactivate any time to continue.",
    },
  };
  const status = org.status ?? "suspended";
  const info = labels[status] ?? labels.suspended;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <CardTitle>{info.title}</CardTitle>
          </div>
          <CardDescription>{info.desc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border p-4 bg-muted/40 text-sm space-y-1">
            <div><span className="text-muted-foreground">Organization:</span> <strong>{org.organizationName}</strong></div>
            <div><span className="text-muted-foreground">Status:</span> <strong className="capitalize">{status.replace("_", " ")}</strong></div>
          </div>
          <Link to="/settings/subscription">
            <Button variant="outline" className="w-full"><Settings className="h-4 w-4 mr-2" />Manage subscription</Button>
          </Link>
          <a href="mailto:billing@cdms.app?subject=CDMS%20subscription">
            <Button className="w-full"><Mail className="h-4 w-4 mr-2" />Contact billing</Button>
          </a>
          <Button variant="ghost" className="w-full" onClick={() => signOut()}>Sign out</Button>
        </CardContent>
      </Card>
    </div>
  );
}
