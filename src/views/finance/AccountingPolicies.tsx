import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Scale, Info } from "lucide-react";

/**
 * Accounting policy for supplier-customer netting (IAS 32 set-off).
 * The contra settlement engine and the statements read this policy.
 */
export default function AccountingPolicies() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: policy, isLoading } = useQuery({
    queryKey: ["accounting-policy"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_accounting_policy");
      if (error) throw error;
      return data as any;
    },
  });

  const [nettingEnabled, setNettingEnabled] = useState(true);
  const [basis, setBasis] = useState("gross");
  const [requireEvidence, setRequireEvidence] = useState(true);
  const [threshold, setThreshold] = useState("0");
  const [sameCurrencyOnly, setSameCurrencyOnly] = useState(true);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!policy) return;
    setNettingEnabled(!!policy.netting_enabled);
    setBasis(policy.presentation_basis ?? "gross");
    setRequireEvidence(!!policy.require_setoff_evidence);
    setThreshold(String(policy.offset_approval_threshold ?? 0));
    setSameCurrencyOnly(policy.same_currency_only !== false);
    setNote(policy.policy_note ?? "");
  }, [policy]);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("save_accounting_policy", {
        _netting_enabled: nettingEnabled,
        _presentation_basis: basis,
        _require_setoff_evidence: requireEvidence,
        _offset_approval_threshold: parseFloat(threshold) || 0,
        _same_currency_only: sameCurrencyOnly,
        _policy_note: note || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounting-policy"] });
      qc.invalidateQueries({ queryKey: ["counterparty-reconciliation"] });
      toast({ title: "Accounting policy saved" });
    },
    onError: (e: any) => toast({ title: "Could not save policy", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Scale className="h-5 w-5" />Accounting policies
        </h1>
        <p className="text-muted-foreground text-sm">
          Set-off (netting) rules applied when a counterparty is both a customer and a supplier.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>IAS 32.42</AlertTitle>
        <AlertDescription className="text-sm">
          A financial asset and a financial liability may only be offset when there is a currently legally enforceable
          right of set-off and the intention to settle net or realise the asset and settle the liability simultaneously.
          Keep the presentation basis <strong>gross</strong> unless both conditions are documented for every counterparty.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Supplier–customer netting</CardTitle>
          <CardDescription>These settings are enforced by the contra settlement engine, not just advisory.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <Label className="text-sm">Allow set-off between AR and AP</Label>
              <p className="text-xs text-muted-foreground">When off, no new set-offs can be posted and existing ones are flagged in reconciliation.</p>
            </div>
            <Switch checked={nettingEnabled} onCheckedChange={setNettingEnabled} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Statement presentation basis</Label>
              <Select value={basis} onValueChange={setBasis}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gross">Gross (IAS 32 default)</SelectItem>
                  <SelectItem value="net">Net position per counterparty</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Gross keeps AR and AP separate on statements; net shows a single counterparty position.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Set-off approval threshold</Label>
              <Input type="number" step="0.01" min="0" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Set-offs at or above this amount are routed for approval before posting. 0 posts immediately.
              </p>
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <Label className="text-sm">Require set-off evidence reference</Label>
              <p className="text-xs text-muted-foreground">Operators must record the agreement / correspondence reference proving the right of set-off.</p>
            </div>
            <Switch checked={requireEvidence} onCheckedChange={setRequireEvidence} />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <Label className="text-sm">Same currency only</Label>
              <p className="text-xs text-muted-foreground">Blocks offsetting a USD receivable against a KES payable without an explicit conversion.</p>
            </div>
            <Switch checked={sameCurrencyOnly} onCheckedChange={setSameCurrencyOnly} />
          </div>

          <div className="space-y-2">
            <Label>Policy note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
              placeholder="e.g. Set-off applied only where a signed netting agreement exists with the counterparty." />
          </div>

          <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading}>Save policy</Button>
        </CardContent>
      </Card>
    </div>
  );
}
