import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Save, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { useAppSettings } from "@/hooks/use-app-settings";
import { setAppSettings } from "@/lib/app-settings";
import { billingItems } from "@/components/AppSidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

/** Readable groupings for the Billing & Finance sidebar entries. */
const SECTIONS: { label: string; keys: string[] }[] = [
  { label: "Dashboard & Ledger", keys: ["finance_dashboard", "chart_of_accounts", "manual_journals", "transactions", "ledger_search", "fiscal_periods"] },
  { label: "Invoicing & Receivables", keys: ["tariffs", "invoices", "recurring_invoices", "payments", "contra_settlements", "reconciliation", "dunning", "statements"] },
  { label: "Payables & Expenses", keys: ["supplier_invoices", "supplier_pricing", "operating_expenses", "expense_categories", "opex_report", "expense_claims", "petty_cash"] },
  { label: "Banking", keys: ["bank_cash_accounts", "inter_account_transfers", "bank_reconciliations"] },
  { label: "Reports", keys: ["trial_balance", "profit_loss", "balance_sheet", "aging_reports", "financial_summary", "projects"] },
  { label: "Tax", keys: ["tax_codes", "tax_returns", "withholding"] },
  { label: "Budgets & Planning", keys: ["budgets", "budget_variance", "budgets_vs_actual", "cashflow_forecast", "fx_revaluation"] },
  { label: "Assets & Period Close", keys: ["fixed_assets", "approvals", "period_close", "year_end_close", "finance_audit_log"] },
];

export default function FinanceNavSection() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { t } = useTranslation(["nav"]);
  const { hiddenFinanceNav } = useAppSettings();
  const [hidden, setHidden] = useState<string[]>(hiddenFinanceNav);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setHidden(hiddenFinanceNav); }, [hiddenFinanceNav]);

  const allKeys = useMemo(() => billingItems.map((i) => i.key), []);
  const grouped = useMemo(() => {
    const known = new Set(SECTIONS.flatMap((s) => s.keys));
    const others = allKeys.filter((k) => !known.has(k));
    const sections = SECTIONS.map((s) => ({
      label: s.label,
      keys: s.keys.filter((k) => allKeys.includes(k)),
    })).filter((s) => s.keys.length);
    return others.length ? [...sections, { label: "Other", keys: others }] : sections;
  }, [allKeys]);

  const dirty = hidden.length !== hiddenFinanceNav.length || hidden.some((k) => !hiddenFinanceNav.includes(k));

  const toggle = (key: string, visible: boolean) =>
    setHidden((prev) => (visible ? prev.filter((k) => k !== key) : prev.includes(key) ? prev : [...prev, key]));

  const save = async () => {
    if (!org.organizationId) return;
    setSaving(true);
    try {
      // Read-modify-write so other config keys are preserved.
      const { data, error } = await supabase
        .from("organizations")
        .select("config")
        .eq("id", org.organizationId)
        .maybeSingle();
      if (error) throw error;
      const config = { ...((data?.config as any) ?? {}), finance_nav: { hidden } };
      const { error: upErr } = await supabase
        .from("organizations")
        .update({ config })
        .eq("id", org.organizationId);
      if (upErr) throw upErr;
      setAppSettings({ hiddenFinanceNav: hidden });
      qc.invalidateQueries({ queryKey: ["app-settings-org", org.organizationId] });
      toast.success("Finance sidebar updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save sidebar settings");
    } finally {
      setSaving(false);
    }
  };

  const visibleCount = allKeys.length - hidden.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Finance sidebar items</CardTitle>
        <CardDescription>
          Choose which entries appear under "Billing &amp; Finance" in the sidebar. Applies to everyone in the
          organization. Hiding an item does not change anyone's permissions — the page stays reachable by URL.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground mr-auto">{visibleCount} of {allKeys.length} shown</span>
          <Button variant="outline" size="sm" onClick={() => setHidden([])}>Select all</Button>
          <Button variant="outline" size="sm" onClick={() => setHidden(allKeys)}>Clear all</Button>
          <Button variant="outline" size="sm" onClick={() => setHidden([])}>
            <RotateCcw className="h-3.5 w-3.5 me-1.5" />Reset to default
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            <Save className="h-3.5 w-3.5 me-1.5" />{saving ? "Saving…" : "Save"}
          </Button>
        </div>

        {visibleCount === 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            All items are hidden — the Billing &amp; Finance group will not appear in the sidebar at all.
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {grouped.map((section) => (
            <div key={section.label} className="space-y-2">
              <h3 className="text-sm font-semibold">{section.label}</h3>
              <div className="rounded-md border divide-y">
                {section.keys.map((key) => (
                  <div key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm">{t(`nav:${key}`, { defaultValue: key })}</span>
                    <Switch checked={!hidden.includes(key)} onCheckedChange={(v) => toggle(key, v)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
