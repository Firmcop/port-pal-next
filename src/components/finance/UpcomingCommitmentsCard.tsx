import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoneyCode } from "@/lib/money";
import { CalendarClock, Landmark, ReceiptText, ArrowRight } from "lucide-react";
import { format, parseISO } from "date-fns";

type Commitment = {
  kind: string;
  source_id: string;
  title: string;
  due_date: string;
  amount: number | null;
  currency: string;
  status: string;
  days_until: number;
};

const dueLabel = (d: number) =>
  d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? "Due today" : `in ${d}d`;

const dueTone = (d: number) =>
  d < 0
    ? "bg-destructive/15 text-destructive"
    : d <= 7
      ? "bg-warning/15 text-warning"
      : "bg-muted text-muted-foreground";

export default function UpcomingCommitmentsCard({ days = 30, limit = 10 }: { days?: number; limit?: number }) {
  const { data, isLoading } = useQuery<Commitment[]>({
    queryKey: ["commitments-due-card", days],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("commitments_due", { _days: days });
      if (error) throw error;
      return (data ?? []) as Commitment[];
    },
  });

  const rows = (data ?? []).slice(0, limit);
  const overdue = (data ?? []).filter((r) => r.days_until < 0).length;
  const soon = (data ?? []).filter((r) => r.days_until >= 0 && r.days_until <= 7).length;

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />Upcoming commitments
        </CardTitle>
        <div className="flex items-center gap-2">
          {overdue > 0 && <Badge variant="secondary" className="bg-destructive/15 text-destructive">{overdue} overdue</Badge>}
          {soon > 0 && <Badge variant="secondary" className="bg-warning/15 text-warning">{soon} this week</Badge>}
          <Button asChild variant="ghost" size="sm">
            <Link to="/finance/commitments">All<ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : !rows.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing falls due in the next {days} days</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => {
              const inner = (
                <div className="flex items-center gap-3 py-2">
                  {r.kind === "loan" ? (
                    <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ReceiptText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(parseISO(r.due_date), "dd MMM yyyy")}
                      {r.kind === "recurring_expense" ? " · recurring expense" : " · loan instalment"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm">{r.amount != null ? formatMoneyCode(r.amount, r.currency) : "—"}</p>
                    <Badge variant="secondary" className={`text-[10px] ${dueTone(r.days_until)}`}>{dueLabel(r.days_until)}</Badge>
                  </div>
                </div>
              );
              return (
                <li key={`${r.kind}-${r.source_id}-${r.due_date}`}>
                  {r.kind === "loan" ? (
                    <Link to={`/finance/loans/${r.source_id}`} className="block hover:bg-muted/50 rounded px-1">{inner}</Link>
                  ) : (
                    <div className="px-1">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
