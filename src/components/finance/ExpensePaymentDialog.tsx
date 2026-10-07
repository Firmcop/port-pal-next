import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fmtMoney } from "@/lib/finance-format";
import { mapRepatriationError } from "@/lib/repatriation-errors";

export function ExpensePaymentDialog({
  expense,
  onOpenChange,
}: {
  expense: any | null;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const outstanding = Number(expense?.total_amount ?? 0) - Number(expense?.amount_paid ?? 0);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [payDate, setPayDate] = useState(format(new Date(), "yyyy-MM-dd"));

  useEffect(() => {
    if (expense) {
      setAmount(outstanding > 0 ? String(outstanding) : "");
      setPayDate(format(new Date(), "yyyy-MM-dd"));
    }
  }, [expense?.id]);

  const { data: accounts } = useQuery({
    queryKey: ["financial-accounts-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("financial_accounts").select("id,name").eq("is_active", true).order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const pay = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("pay_operating_expense", {
        _expense_id: expense.id,
        _financial_account_id: accountId,
        _amount: Number(amount),
        _payment_date: payDate,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      ["operating-expenses", "accounting-transactions", "account-balances", "finance-dashboard"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
      onOpenChange(false);
      toast({ title: "Payment recorded" });
    },
    onError: (e: any) => toast({ title: "Could not record payment", description: mapRepatriationError(e), variant: "destructive" }),
  });

  return (
    <Dialog open={!!expense} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Record payment — {expense?.expense_number}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Outstanding: <span className="font-mono">{fmtMoney(outstanding, expense?.currency)}</span>
          </p>
          <div><Label>Payment date</Label><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
          <div>
            <Label>Paid from</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Bank / cash account" /></SelectTrigger>
              <SelectContent>
                {(accounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Amount</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => pay.mutate()}
            disabled={!accountId || !(Number(amount) > 0) || Number(amount) > outstanding + 0.001 || pay.isPending}
          >
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
