import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link, useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, CheckCircle2, Container, Loader2, ArrowLeft, ArrowRight, Circle } from "lucide-react";
import { COUNTRIES } from "@/lib/locale-data";

/**
 * Public signup in three steps, modelled on Odoo's trial: pick modules, give a few
 * details, watch the company get set up, land inside the app.
 */

type Module = { code: string; name: string; description: string | null; monthly_price: number; is_core: boolean; sort_order: number };
type Step = "modules" | "details" | "setup";

const BUSINESS_TYPES: { id: string; label: string; suggest: string[] }[] = [
  { id: "depot", label: "Container depot", suggest: ["inventory", "gate", "mr", "billing", "accounting"] },
  { id: "cfs", label: "CFS / ICD", suggest: ["inventory", "gate", "billing", "accounting", "logistics"] },
  { id: "conversions", label: "Container conversions", suggest: ["inventory", "manufacturing", "procurement", "crm", "accounting"] },
  { id: "transport", label: "Transport & logistics", suggest: ["logistics", "billing", "accounting"] },
  { id: "trading", label: "Container trading & leasing", suggest: ["inventory", "crm", "leasing", "billing", "accounting"] },
  { id: "other", label: "Something else", suggest: ["inventory", "billing"] },
];

const SIZES = [
  { id: "1-10", label: "1–10 people" },
  { id: "11-50", label: "11–50 people" },
  { id: "51-200", label: "51–200 people" },
  { id: "200+", label: "More than 200" },
];

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function StartTrial() {
  const navigate = useNavigate();
  const startedAt = useRef(Date.now());
  const [step, setStep] = useState<Step>("modules");
  const [businessType, setBusinessType] = useState<string>("depot");
  const [picked, setPicked] = useState<Set<string>>(new Set<string>(BUSINESS_TYPES[0].suggest));
  const [form, setForm] = useState({
    full_name: "", email: "", phone: "", password: "", company: "", country: "", company_size: "", depot_name: "", website: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{ message: string; exists?: boolean } | null>(null);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<any>(null);

  const { data: modules = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["public-modules-catalog"],
    queryFn: async (): Promise<Module[]> => {
      const { data, error } = await supabase
        .from("modules_catalog")
        .select("code, name, description, monthly_price, is_core, sort_order")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Module[];
    },
  });

  const core = modules.filter((m) => m.is_core);
  const optional = modules.filter((m) => !m.is_core);
  const monthly = useMemo(
    () => modules.filter((m) => m.is_core || picked.has(m.code)).reduce((s, m) => s + Number(m.monthly_price), 0),
    [modules, picked],
  );
  const country = COUNTRIES.find((c) => c.name === form.country);

  const chooseType = (id: string) => {
    setBusinessType(id);
    setPicked(new Set<string>(BUSINESS_TYPES.find((b) => b.id === id)?.suggest ?? []));
  };
  const toggle = (code: string) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(code) ? n.delete(code) : n.add(code);
      return n;
    });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.full_name.trim().length < 2) e.full_name = "Enter your name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) e.email = "Enter a valid work email";
    if (form.password.length < 8) e.password = "Use at least 8 characters";
    if (form.company.trim().length < 2) e.company = "Enter your company name";
    if (!form.country) e.country = "Choose your country";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const SETUP_STEPS = [
    "Creating your account",
    `Setting up ${form.company.trim() || "your company"}`,
    `Chart of accounts and taxes for ${form.country || "your country"}`,
    `Opening fiscal year ${new Date().getFullYear()}`,
    `Turning on ${picked.size + core.length} modules`,
    "Signing you in",
  ];

  // Tick through the steps while the server works; the last ones wait for the answer.
  useEffect(() => {
    if (step !== "setup" || summary) return;
    const t = setInterval(() => setProgress((p) => Math.min(p + 1, SETUP_STEPS.length - 2)), 700);
    return () => clearInterval(t);
  }, [step, summary, SETUP_STEPS.length]);

  const submit = async () => {
    if (!validate()) return;
    setFailure(null);
    setStep("setup");
    setProgress(0);
    const body = {
      ...form,
      email: form.email.trim(),
      modules: [...picked],
      business_type: businessType,
      currency: country?.currency ?? "USD",
      timezone: country?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      started_at: startedAt.current,
    };
    const { data, error } = await supabase.functions.invoke("start-trial", { body });
    const payload: any = data ?? (await (error as any)?.context?.json?.().catch(() => null));
    if (error || !payload?.ok) {
      setStep("details");
      if (payload?.fields) setErrors(payload.fields);
      setFailure({
        message: payload?.message ?? payload?.error ?? "Something went wrong. Please try again.",
        exists: payload?.error === "account_exists",
      });
      return;
    }
    setSummary(payload);
    setProgress(SETUP_STEPS.length - 1);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: body.email, password: form.password });
    if (signInError) {
      setFailure({ message: "Your company is ready, but signing in failed. Please sign in.", exists: true });
      setStep("details");
      return;
    }
    setProgress(SETUP_STEPS.length);
    setTimeout(() => navigate("/?welcome=1", { replace: true }), 700);
  };

  return (
    <main className="min-h-screen bg-muted/30">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <Link to="/login" className="flex items-center gap-2 font-semibold">
            <span className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Container className="h-5 w-5 text-primary-foreground" />
            </span>
            Port Pal
          </Link>
          <p className="text-sm text-muted-foreground">
            Already have an account? <Link to="/login" className="text-primary font-medium hover:underline">Sign in</Link>
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6 min-w-0">
          <ol className="flex items-center gap-2 text-sm" aria-label="Signup steps">
            {(["modules", "details", "setup"] as Step[]).map((s, i) => {
              const current = ["modules", "details", "setup"].indexOf(step);
              const done = i < current;
              return (
                <li key={s} className="flex items-center gap-2">
                  <span className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium ${
                    i === current ? "bg-primary text-primary-foreground" : done ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className={i === current ? "font-medium" : "text-muted-foreground"}>
                    {s === "modules" ? "Choose modules" : s === "details" ? "Your details" : "Set up"}
                  </span>
                  {i < 2 && <span className="w-8 h-px bg-border" />}
                </li>
              );
            })}
          </ol>

          {step === "modules" && (
            <>
              <div>
                <h1 className="text-2xl font-bold">Start your 30-day free trial</h1>
                <p className="text-muted-foreground mt-1">Tell us what you run and we'll suggest modules. You can change them any time.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {BUSINESS_TYPES.map((b) => (
                  <Button key={b.id} type="button" size="sm" variant={businessType === b.id ? "default" : "outline"} onClick={() => chooseType(b.id)}>
                    {b.label}
                  </Button>
                ))}
              </div>
              {isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading modules…</div>
              ) : isError ? (
                <div role="alert" className="rounded-md border px-3 py-2 text-sm">
                  We couldn't load the module list. <button className="text-primary font-medium hover:underline" onClick={() => refetch()}>Try again</button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {core.map((m) => (
                    <ModuleCard key={m.code} m={m} selected locked />
                  ))}
                  {optional.map((m) => (
                    <ModuleCard key={m.code} m={m} selected={picked.has(m.code)} onToggle={() => toggle(m.code)} />
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <Button onClick={() => setStep("details")} disabled={picked.size === 0 || !modules.length}>
                  Continue <ArrowRight className="ms-2 h-4 w-4" />
                </Button>
              </div>
            </>
          )}

          {step === "details" && (
            <Card>
              <CardContent className="p-6 space-y-5">
                <div>
                  <h1 className="text-2xl font-bold">Your details</h1>
                  <p className="text-muted-foreground mt-1">No card needed. You'll be inside in under a minute.</p>
                </div>
                {failure && (
                  <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
                    {failure.message}{" "}
                    {failure.exists && <Link to="/login" className="font-medium text-primary hover:underline">Go to sign in</Link>}
                  </div>
                )}
                <form
                  className="grid gap-4 sm:grid-cols-2"
                  onSubmit={(e) => { e.preventDefault(); submit(); }}
                  noValidate
                >
                  <Field id="full_name" label="Your name" error={errors.full_name}>
                    <Input id="full_name" autoComplete="name" value={form.full_name} onChange={set("full_name")} />
                  </Field>
                  <Field id="email" label="Work email" error={errors.email}>
                    <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} />
                  </Field>
                  <Field id="password" label="Password" error={errors.password} hint="At least 8 characters">
                    <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
                  </Field>
                  <Field id="phone" label="Phone (optional)">
                    <Input id="phone" type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} placeholder="+254 7…" />
                  </Field>
                  <Field id="company" label="Company name" error={errors.company}>
                    <Input id="company" autoComplete="organization" value={form.company} onChange={set("company")} />
                  </Field>
                  <Field id="country" label="Country" error={errors.country}
                         hint={country ? `Currency ${country.currency} · taxes for ${country.name}` : undefined}>
                    <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v })}>
                      <SelectTrigger id="country"><SelectValue placeholder="Choose country" /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.name}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id="company_size" label="Company size">
                    <Select value={form.company_size} onValueChange={(v) => setForm({ ...form, company_size: v })}>
                      <SelectTrigger id="company_size"><SelectValue placeholder="Choose size" /></SelectTrigger>
                      <SelectContent>{SIZES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field id="depot_name" label="First depot or yard (optional)">
                    <Input id="depot_name" value={form.depot_name} onChange={set("depot_name")} placeholder="Mombasa Yard 1" />
                  </Field>
                  {/* Hidden from people; bots fill it in. */}
                  <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden">
                    <label htmlFor="website">Website</label>
                    <input id="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
                  </div>
                  <div className="sm:col-span-2 flex items-center justify-between gap-3 pt-2">
                    <Button type="button" variant="ghost" onClick={() => setStep("modules")}>
                      <ArrowLeft className="me-2 h-4 w-4" /> Modules
                    </Button>
                    <Button type="submit">Start my free trial</Button>
                  </div>
                </form>
                <p className="text-xs text-muted-foreground">
                  We'll email you a link to confirm your address. You can use Port Pal straight away and have 7 days to confirm.
                </p>
              </CardContent>
            </Card>
          )}

          {step === "setup" && (
            <Card>
              <CardContent className="p-6 space-y-5">
                <div>
                  <h1 className="text-2xl font-bold">Setting up {form.company.trim()}</h1>
                  <p className="text-muted-foreground mt-1">This takes a few seconds.</p>
                </div>
                <ul className="space-y-3" aria-live="polite">
                  {SETUP_STEPS.map((label, i) => {
                    const done = i < progress;
                    const active = i === progress;
                    return (
                      <li key={label} className="flex items-center gap-3 text-sm">
                        {done ? <CheckCircle2 className="h-5 w-5 text-primary" />
                          : active ? <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          : <Circle className="h-5 w-5 text-muted-foreground/40" />}
                        <span className={done || active ? "" : "text-muted-foreground"}>{label}</span>
                        {done && i === 2 && summary?.setup && (
                          <span className="text-xs text-muted-foreground">
                            {summary.setup.accounts_added} accounts, {summary.setup.tax_codes_added} tax codes
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="lg:sticky lg:top-6 h-fit">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Your selection</p>
                <p className="text-3xl font-bold">Free</p>
                <p className="text-sm text-muted-foreground">
                  {modules.length ? `for 30 days, then about ${usd(monthly)} per month` : "for 30 days"}
                </p>
              </div>
              <ul className="space-y-1.5 text-sm">
                {modules.filter((m) => m.is_core || picked.has(m.code)).map((m) => (
                  <li key={m.code} className="flex justify-between gap-2">
                    <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-primary" />{m.name}</span>
                    <span className="text-muted-foreground tabular-nums">{Number(m.monthly_price) ? usd(Number(m.monthly_price)) : "Free"}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground border-t pt-3">No card needed. Add or remove modules any time from Settings.</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function ModuleCard({ m, selected, locked, onToggle }: { m: Module; selected: boolean; locked?: boolean; onToggle?: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={locked}
      aria-pressed={selected}
      className={`text-start rounded-lg border bg-card p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"} ${locked ? "cursor-default" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{m.name}</span>
        <span className={`h-5 w-5 shrink-0 rounded border flex items-center justify-center ${selected ? "bg-primary border-primary text-primary-foreground" : ""}`}>
          {selected && <Check className="h-3.5 w-3.5" />}
        </span>
      </div>
      {m.description && <p className="text-sm text-muted-foreground mt-1">{m.description}</p>}
      <p className="text-xs text-muted-foreground mt-2">
        {locked ? "Always included" : Number(m.monthly_price) ? `${usd(Number(m.monthly_price))}/month after trial` : "Free"}
      </p>
    </button>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
