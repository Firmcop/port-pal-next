import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoneyCode } from "@/lib/money";
import { format, parseISO, isBefore } from "date-fns";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { CalendarRange } from "lucide-react";

type ScheduleLine = {
  id: string;
  seq: number;
  due_date: string;
  opening_balance: number;
  principal_due: number;
  interest_due: number;
  total_due: number;
  paid_amount: number;
  closing_balance: number;
  status: string;
};

const stateOf = (s: ScheduleLine) => {
  const shortfall = Number(s.total_due) - Number(s.paid_amount);
  if (s.status === "paid" || shortfall <= 0.01) return "paid";
  if (s.status === "cancelled") return "cancelled";
  if (isBefore(parseISO(s.due_date), new Date())) return shortfall < Number(s.total_due) ? "arrears" : "arrears";
  return Number(s.paid_amount) > 0 ? "part_paid" : "expected";
};

const stateTone: Record<string, string> = {
  paid: "bg-success/15 text-success",
  part_paid: "bg-warning/15 text-warning",
  arrears: "bg-destructive/15 text-destructive",
  expected: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

export default function LoanAmortizationTimeline({
  schedule,
  currency,
  onSelect,
}: {
  schedule: ScheduleLine[];
  currency?: string;
  onSelect?: (seq: number) => void;
}) {
  const [arrearsOnly, setArrearsOnly] = useState(false);

  const rows = useMemo(() => {
    const mapped = (schedule ?? []).map((s) => {
      const st = stateOf(s);
      return {
        ...s,
        state: st,
        shortfall: Math.max(Number(s.total_due) - Number(s.paid_amount), 0),
        label: `#${s.seq}`,
        principal: Number(s.principal_due),
        interest: Number(s.interest_due),
        balance: Number(s.closing_balance),
      };
    });
    return arrearsOnly ? mapped.filter((r) => r.state === "arrears") : mapped;
  }, [schedule, arrearsOnly]);

  const todayIdx = useMemo(() => {
    const next = rows.find((r) => !isBefore(parseISO(r.due_date), new Date()));
    return next?.label;
  }, [rows]);

  const totals = useMemo(() => {
    const all = rows;
    return {
      paid: all.reduce((s, r) => s + Number(r.paid_amount), 0),
      due: all.reduce((s, r) => s + Number(r.total_due), 0),
      arrears: all.filter((r) => r.state === "arrears").reduce((s, r) => s + r.shortfall, 0),
      arrearsCount: all.filter((r) => r.state === "arrears").length,
    };
  }, [rows]);

  if (!schedule?.length) {
    return (
      <Card><CardContent className="p-8 text-center text-muted-foreground">
        No schedule yet — regenerate the schedule to see the amortization timeline
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="h-4 w-4" />Amortization timeline
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className={totals.arrearsCount ? stateTone.arrears : stateTone.expected}>
              {totals.arrearsCount} instalment(s) in arrears · {formatMoneyCode(totals.arrears, currency)}
            </Badge>
            <Button variant={arrearsOnly ? "default" : "outline"} size="sm" onClick={() => setArrearsOnly((v) => !v)}>
              Arrears only
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => Intl.NumberFormat(undefined, { notation: "compact" }).format(v)} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => Intl.NumberFormat(undefined, { notation: "compact" }).format(v)} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const r: any = payload[0].payload;
                    return (
                      <div className="rounded-md border bg-popover p-3 text-xs shadow-md space-y-1">
                        <p className="font-medium">Instalment #{r.seq} · {format(parseISO(r.due_date), "dd MMM yyyy")}</p>
                        <p>Principal: <span className="font-mono">{formatMoneyCode(r.principal, currency)}</span></p>
                        <p>Interest: <span className="font-mono">{formatMoneyCode(r.interest, currency)}</span></p>
                        <p>Total due: <span className="font-mono">{formatMoneyCode(r.total_due, currency)}</span></p>
                        <p>Paid: <span className="font-mono">{formatMoneyCode(r.paid_amount, currency)}</span></p>
                        <p>Shortfall: <span className="font-mono">{formatMoneyCode(r.shortfall, currency)}</span></p>
                        <p>Closing balance: <span className="font-mono">{formatMoneyCode(r.balance, currency)}</span></p>
                        <p className="capitalize text-muted-foreground">{r.state.replace(/_/g, " ")}</p>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="principal" name="Principal" stackId="a" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]}
                  onClick={(d: any) => onSelect?.(d?.seq)} cursor="pointer" />
                <Bar yAxisId="left" dataKey="interest" name="Interest" stackId="a" fill="hsl(var(--warning))"
                  onClick={(d: any) => onSelect?.(d?.seq)} cursor="pointer" />
                <Bar yAxisId="left" dataKey="shortfall" name="Shortfall" fill="hsl(var(--destructive))" opacity={0.5}
                  onClick={(d: any) => onSelect?.(d?.seq)} cursor="pointer" />
                <Line yAxisId="right" type="monotone" dataKey="balance" name="Outstanding balance" stroke="hsl(var(--foreground))" dot={false} strokeWidth={2} />
                {todayIdx && <ReferenceLine yAxisId="left" x={todayIdx} stroke="hsl(var(--destructive))" strokeDasharray="4 4" label={{ value: "today", fontSize: 10 }} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Instalments</p><p className="font-mono">{rows.length}</p></div>
            <div><p className="text-xs text-muted-foreground">Total scheduled</p><p className="font-mono">{formatMoneyCode(totals.due, currency)}</p></div>
            <div><p className="text-xs text-muted-foreground">Total paid</p><p className="font-mono">{formatMoneyCode(totals.paid, currency)}</p></div>
            <div><p className="text-xs text-muted-foreground">Arrears</p><p className="font-mono text-destructive">{formatMoneyCode(totals.arrears, currency)}</p></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Instalments</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left font-normal p-2">#</th>
                <th className="text-left font-normal p-2">Due</th>
                <th className="text-right font-normal p-2">Principal</th>
                <th className="text-right font-normal p-2">Interest</th>
                <th className="text-right font-normal p-2">Total</th>
                <th className="text-right font-normal p-2">Paid</th>
                <th className="text-right font-normal p-2">Shortfall</th>
                <th className="text-left font-normal p-2">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} id={`instalment-${r.seq}`} className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                  onClick={() => onSelect?.(r.seq)}>
                  <td className="p-2 text-xs text-muted-foreground">{r.seq}</td>
                  <td className="p-2">{format(parseISO(r.due_date), "dd MMM yyyy")}</td>
                  <td className="p-2 text-right font-mono text-xs">{formatMoneyCode(r.principal, currency)}</td>
                  <td className="p-2 text-right font-mono text-xs">{formatMoneyCode(r.interest, currency)}</td>
                  <td className="p-2 text-right font-mono">{formatMoneyCode(r.total_due, currency)}</td>
                  <td className="p-2 text-right font-mono text-xs">{formatMoneyCode(r.paid_amount, currency)}</td>
                  <td className={`p-2 text-right font-mono text-xs ${r.shortfall > 0 ? "text-destructive" : ""}`}>{formatMoneyCode(r.shortfall, currency)}</td>
                  <td className="p-2"><Badge variant="secondary" className={stateTone[r.state]}>{r.state.replace(/_/g, " ")}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
