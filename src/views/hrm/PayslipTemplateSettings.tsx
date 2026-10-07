import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { buildPayslipHtml } from "@/lib/payslip-pdf";
import { getDefaultCurrency } from "@/lib/finance-format";
import { useOrgCurrency } from "@/hooks/use-org-currency";

const LANGS = [
  { code: "default", label: "Default (all languages)" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "sw", label: "Kiswahili" },
  { code: "ar", label: "العربية" },
];

const SYMBOL_MAP: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹" };

function emptyFor(currency: string) {
  return {
    language: null as string | null,
    logo_url: "",
    header_address: "",
    footer_text: "",
    signature_block_text: "",
    currency_code: currency,
    currency_symbol: SYMBOL_MAP[currency?.toUpperCase()] ?? `${currency} `,
    currency_position: "before",
    decimal_places: 2,
    accent_color: "#1e3a5f",
  };
}

export default function PayslipTemplateSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  useOrgCurrency(); // ensure default currency is loaded
  const orgCurrency = getDefaultCurrency();
  const EMPTY = emptyFor(orgCurrency);
  const [tab, setTab] = useState("default");
  const [form, setForm] = useState(EMPTY);

  const { data: rows = [] } = useQuery({
    queryKey: ["payslip-pdf-settings-all"],
    queryFn: async () => (await (supabase as any).from("payslip_pdf_settings").select("*")).data ?? [],
  });

  useEffect(() => {
    const lang = tab === "default" ? null : tab;
    const row = rows.find((r: any) => (r.language ?? null) === lang);
    setForm(row ? { ...EMPTY, ...row, language: lang } : { ...EMPTY, language: lang });
  }, [tab, rows, orgCurrency]);


  const save = useMutation({
    mutationFn: async () => {
      const lang = tab === "default" ? null : tab;
      const existing = rows.find((r: any) => (r.language ?? null) === lang);
      const payload = { ...form, language: lang };
      if (existing) {
        const { error } = await (supabase as any).from("payslip_pdf_settings").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("payslip_pdf_settings").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast({ title: "Settings saved" }); qc.invalidateQueries({ queryKey: ["payslip-pdf-settings-all"] }); qc.invalidateQueries({ queryKey: ["payslip-pdf-settings"] }); },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const previewHtml = buildPayslipHtml({
    reference: "PSL-PREVIEW", status: "posted", pay_date: "2026-05-31", period_start: "2026-05-01", period_end: "2026-05-31",
    gross_pay: 1500, total_deductions: 200, total_contributions: 100, net_pay: 1300,
    employee: { name: "Jane Doe", code: "EMP001", division: "Operations", tax_id: "TAX12345", email: "jane@example.com" },
    organization: { name: "Your Organization" },
    lines: [
      { line_type: "earning", label: "Basic salary", amount: 1500 },
      { line_type: "deduction", label: "Income tax", amount: 200 },
      { line_type: "contribution", label: "Pension (employer)", amount: 100 },
    ],
    settings: form as any,
    language: tab === "default" ? "en" : tab,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Settings2 className="h-6 w-6" />Payslip PDF Template</h1>
          <p className="text-muted-foreground">Customize logo, address, currency formatting, accent color, and footer per language.</p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}><Save className="mr-1 h-4 w-4" />Save</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>{LANGS.map((l) => <TabsTrigger key={l.code} value={l.code}>{l.label}</TabsTrigger>)}</TabsList>
        {LANGS.map((l) => (
          <TabsContent key={l.code} value={l.code} className="grid lg:grid-cols-2 gap-4 mt-4">
            <Card><CardHeader><CardTitle className="text-base">Settings — {l.label}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1"><Label>Logo URL</Label><Input value={form.logo_url ?? ""} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="https://…" /></div>
                <div className="space-y-1"><Label>Header address</Label><Textarea value={form.header_address ?? ""} onChange={(e) => setForm({ ...form, header_address: e.target.value })} rows={3} /></div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1"><Label>Currency code</Label><Input value={form.currency_code} onChange={(e) => setForm({ ...form, currency_code: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Symbol</Label><Input value={form.currency_symbol} onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Decimals</Label><Input type="number" min={0} max={4} value={form.decimal_places} onChange={(e) => setForm({ ...form, decimal_places: parseInt(e.target.value) || 0 })} /></div>
                </div>
                <div className="space-y-1"><Label>Symbol position</Label>
                  <Select value={form.currency_position} onValueChange={(v) => setForm({ ...form, currency_position: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="before">Before amount ($100)</SelectItem><SelectItem value="after">After amount (100 $)</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Accent color</Label><Input type="color" value={form.accent_color} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} className="h-10 w-24" /></div>
                <div className="space-y-1"><Label>Footer text</Label><Textarea value={form.footer_text ?? ""} onChange={(e) => setForm({ ...form, footer_text: e.target.value })} rows={2} /></div>
                <div className="space-y-1"><Label>Signature block</Label><Textarea value={form.signature_block_text ?? ""} onChange={(e) => setForm({ ...form, signature_block_text: e.target.value })} rows={2} placeholder="Authorized signatory&#10;HR Manager" /></div>
              </CardContent>
            </Card>
            <Card><CardHeader><CardTitle className="text-base">Preview</CardTitle></CardHeader>
              <CardContent className="p-0">
                <iframe title="payslip-preview" srcDoc={previewHtml} className="w-full h-[640px] border-0 bg-white" />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
