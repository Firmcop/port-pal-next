import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const fmtMoney = (n: number, c: string) =>
  `${c} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Optional manual exchange rate for one acquisition component. Only rendered
 * when the component currency differs from the organisation's base currency.
 * Left blank, the rate on the FX Rates table is used instead.
 */
export default function FxRateInput({
  amount,
  currency,
  baseCurrency,
  value,
  onChange,
  organizationId,
}: {
  amount: number;
  currency: string;
  baseCurrency: string;
  value: string;
  onChange: (v: string) => void;
  organizationId?: string | null;
}) {
  const from = (currency || "").toUpperCase();
  const to = (baseCurrency || "").toUpperCase();
  const needed = !!from && !!to && from !== to;

  const { data: tableRate } = useQuery({
    queryKey: ["fx-rate-hint", organizationId, from, to],
    enabled: needed && !!organizationId,
    queryFn: async () => {
      const { data } = await supabase.rpc("get_fx_rate_detail" as any, {
        _org: organizationId,
        _from: from,
        _to: to,
        _on: new Date().toISOString().slice(0, 10),
      });
      const rate = Number((data as any)?.rate ?? 0);
      return rate > 0 ? rate : null;
    },
  });

  if (!needed) return null;

  const effective = Number(value) > 0 ? Number(value) : tableRate ?? null;

  return (
    <div className="space-y-1">
      <Label className="text-xs">
        Exchange rate {from} → {to}
      </Label>
      <Input
        type="number"
        step="0.000001"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={tableRate ? `${tableRate} (stored rate)` : "Enter the rate you used"}
      />
      <p className="text-xs text-muted-foreground">
        {effective
          ? `${fmtMoney(amount, from)} x ${effective.toLocaleString(undefined, { maximumFractionDigits: 6 })} = ${fmtMoney(
              amount * effective,
              to,
            )}${Number(value) > 0 ? " (manual rate)" : " (stored rate)"}`
          : "No stored rate — type the actual rate you used."}
      </p>
    </div>
  );
}
