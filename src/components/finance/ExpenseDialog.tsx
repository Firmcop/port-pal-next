import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Upload, ScanLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fmtMoney, getDefaultCurrency } from "@/lib/finance-format";
import { uploadExpenseAttachments } from "@/lib/expense-attachments";
import { JobCombobox, useConversionJobs } from "@/components/finance/JobCombobox";

type Line = {
  category_id: string;
  gl_account_id: string;
  description: string;
  amount: string;
  tax_code_id: string;
  project_id: string;
  depot_id: string;
};

const emptyLine = (): Line => ({ category_id: "", gl_account_id: "", description: "", amount: "", tax_code_id: "", project_id: "", depot_id: "" });

export function ExpenseDialog({
  open,
  onOpenChange,
  requireProject = false,
  submitOnly = false,
  defaultConversionId,
  defaultProjectId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Force every expense to carry a project / job tag (expense-posting clerks). */
  requireProject?: boolean;
  /** Hide the draft option — the entry must go straight for approval. */
  submitOnly?: boolean;
  /** Pre-tag the expense with a conversion job (opened from the job page). */
  defaultConversionId?: string | null;
  /** Pre-tag the expense with a project. */
  defaultProjectId?: string | null;
}) {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [mode, setMode] = useState<"paid" | "credit">("paid");
  const [expenseDate, setExpenseDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dueDate, setDueDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [supplierId, setSupplierId] = useState("");
  const [payee, setPayee] = useState("");
  const [accountId, setAccountId] = useState("");
  const [currency, setCurrency] = useState(getDefaultCurrency());
  const [depotId, setDepotId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [conversionId, setConversionId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [extracted, setExtracted] = useState<any | null>(null);
  const [scanning, setScanning] = useState(false);

  const { data: categories } = useQuery({
    queryKey: ["expense-categories-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("expense_categories")
        .select("id,name,gl_account_id,tax_code_id,depot_id,project_id")
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: glAccounts } = useQuery({
    queryKey: ["gl-accounts-expense"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("gl_accounts")
        .select("id,code,name,account_type")
        .eq("is_active", true)
        .in("account_type", ["expense", "cost_of_goods"])
        .order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: cashAccounts } = useQuery({
    queryKey: ["financial-accounts-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("financial_accounts")
        .select("id,name,currency")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-for-expense"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("suppliers").select("id,name").order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: taxCodes } = useQuery({
    queryKey: ["tax-codes-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("tax_codes").select("id,code,name,rate").eq("is_active", true).order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: depots } = useQuery({
    queryKey: ["depots-for-expense"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("depots").select("id,name").order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: projects } = useQuery({
    queryKey: ["projects-for-expense"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("projects").select("id,code,name").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: jobs = [] } = useConversionJobs();

  // Pre-fill job / project when opened from a conversion job page.
  useEffect(() => {
    if (!open) return;
    if (defaultConversionId) setConversionId(defaultConversionId);
    if (defaultProjectId) setProjectId(defaultProjectId);
  }, [open, defaultConversionId, defaultProjectId]);

  const pickProject = (v: string) => {
    setProjectId(v);
    const job = jobs.find((j) => j.id === conversionId);
    if (job && job.project_id && job.project_id !== v) setConversionId("");
  };

  const taxRate = (id: string) => Number((taxCodes ?? []).find((t) => t.id === id)?.rate ?? 0);

  const totals = useMemo(() => {
    let sub = 0;
    let tax = 0;
    lines.forEach((l) => {
      const amt = Number(l.amount || 0);
      sub += amt;
      tax += (amt * taxRate(l.tax_code_id)) / 100;
    });
    return { sub, tax, total: sub + tax };
  }, [lines, taxCodes]);

  const valid =
    lines.some((l) => l.gl_account_id && Number(l.amount) > 0) &&
    (mode === "credit" || !!accountId) &&
    (!requireProject || !!projectId || lines.every((l) => !l.gl_account_id || !!l.project_id));

  const reset = () => {
    setLines([emptyLine()]);
    setPayee(""); setSupplierId(""); setReference(""); setNotes(""); setFiles([]);
    setDepotId(""); setProjectId(""); setConversionId("");
  };

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const payload = lines
        .filter((l) => l.gl_account_id && Number(l.amount) > 0)
        .map((l) => ({
          category_id: l.category_id || null,
          gl_account_id: l.gl_account_id,
          description: l.description || null,
          amount: Number(l.amount),
          tax_code_id: l.tax_code_id || null,
          tax_amount: Number(((Number(l.amount) * taxRate(l.tax_code_id)) / 100).toFixed(2)),
          project_id: l.project_id || null,
          depot_id: l.depot_id || null,
        }));

      const { data, error } = await (supabase as any).rpc("post_operating_expense", {
        _expense_date: expenseDate,
        _payment_mode: mode,
        _lines: payload,
        _supplier_id: supplierId || null,
        _payee: payee || null,
        _financial_account_id: mode === "paid" ? accountId : null,
        _due_date: mode === "credit" ? dueDate : null,
        _currency: currency || null,
        _fx_rate: null, // the database applies the day's rate for foreign-currency expenses
        _depot_id: depotId || null,
        _project_id: projectId || null,
        _reference: reference || null,
        _notes: notes || null,
        _attachment_url: null,
        _submit: submit,
        _conversion_id: conversionId || null,
      });
      if (error) throw error;

      const expenseId = data as string;
      if (files.length && expenseId && org.organizationId) {
        await uploadExpenseAttachments(org.organizationId, expenseId, files);
      }
      return expenseId;
    },
    onSuccess: (_id, submit) => {
      ["operating-expenses", "accounting-transactions", "account-balances", "finance-dashboard", "opex-report"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
      reset();
      onOpenChange(false);
      toast({
        title: submit ? "Expense submitted" : "Draft saved",
        description: submit
          ? "It posts to the ledger once approved (or immediately if below the approval threshold)."
          : "No ledger entries created yet.",
      });
    },
    onError: (e: any) => toast({ title: "Could not save expense", description: e.message, variant: "destructive" }),
  });

  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const pickCategory = (i: number, categoryId: string) => {
    const cat = (categories ?? []).find((c) => c.id === categoryId);
    setLine(i, {
      category_id: categoryId,
      gl_account_id: cat?.gl_account_id ?? lines[i].gl_account_id,
      tax_code_id: cat?.tax_code_id ?? lines[i].tax_code_id,
      project_id: cat?.project_id ?? lines[i].project_id,
      depot_id: cat?.depot_id ?? lines[i].depot_id,
    });
  };

  const scanFirstFile = async () => {
    const file = files[0];
    if (!file) return;
    setScanning(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the file"));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1];
      const { data, error } = await supabase.functions.invoke("parse-expense-document", {
        body: { file_base64: base64, mime_type: file.type || "application/pdf", file_name: file.name },
      });
      if (error) throw new Error((error as any).message ?? "Extraction failed");
      if ((data as any)?.error) throw new Error((data as any).error);
      setExtracted((data as any).extracted);
      toast({ title: "Document read", description: "Check the extracted values, then apply them." });
    } catch (e: any) {
      toast({ title: "Could not read document", description: e.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const applyExtraction = () => {
    const x = extracted;
    if (!x) return;
    if (x.invoice_date) setExpenseDate(x.invoice_date);
    if (x.due_date) { setDueDate(x.due_date); setMode("credit"); }
    if (x.currency) setCurrency(String(x.currency).toUpperCase());
    if (x.invoice_number) setReference(String(x.invoice_number));
    if (x.vendor_name) {
      const match = (suppliers ?? []).find(
        (s) => s.name?.toLowerCase().trim() === String(x.vendor_name).toLowerCase().trim()
      );
      if (match) setSupplierId(match.id);
      else setPayee(String(x.vendor_name));
    }
    const taxTotal = Number(x.tax_amount || 0);
    const matchedTax = (taxCodes ?? []).find((t) => {
      const base = Number(x.subtotal || x.total_amount || 0) - (x.subtotal ? 0 : taxTotal);
      return base > 0 && Math.abs((base * Number(t.rate)) / 100 - taxTotal) < 0.05;
    });
    const extractedLines = Array.isArray(x.lines) && x.lines.length
      ? x.lines
      : x.total_amount
      ? [{ description: x.invoice_number ? `Invoice ${x.invoice_number}` : "Supplier invoice", amount: Number(x.subtotal ?? x.total_amount) }]
      : [];
    if (extractedLines.length) {
      setLines(
        extractedLines.map((l: any) => ({
          ...emptyLine(),
          description: String(l.description ?? "").slice(0, 200),
          amount: String(Number(l.amount || 0)),
          tax_code_id: matchedTax?.id ?? "",
        }))
      );
    }
    toast({ title: "Applied", description: "Pick the expense categories, then submit." });
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Record operating expense</DialogTitle></DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="paid">Paid now (bank / cash)</TabsTrigger>
            <TabsTrigger value="credit">On credit (payable)</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label>Date</Label><Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} /></div>
          {mode === "paid" ? (
            <div>
              <Label>Paid from</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Bank / cash account" /></SelectTrigger>
                <SelectContent>
                  {(cashAccounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div><Label>Due date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          )}
          <div>
            <Label>Supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                {(suppliers ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Payee (free text)</Label><Input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="e.g. City Council" /></div>
          <div><Label>Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
          <div>
            <Label>Depot / branch</Label>
            <Select value={depotId} onValueChange={setDepotId}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                {(depots ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Project{requireProject ? " *" : ""}</Label>
            <Select value={projectId} onValueChange={pickProject}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                {(projects ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Job (conversion)</Label>
            <JobCombobox
              value={conversionId}
              projectId={projectId}
              onChange={(id, job) => {
                setConversionId(id);
                if (job?.project_id) setProjectId(job.project_id);
              }}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Tag the job so this cost shows on the job's budget as a direct expense.
            </p>
          </div>
          <div><Label>Reference</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Receipt / invoice no." /></div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Category</TableHead>
                <TableHead className="min-w-[200px]">Expense account</TableHead>
                <TableHead className="min-w-[160px]">Description</TableHead>
                <TableHead className="w-32">Amount</TableHead>
                <TableHead className="w-36">Tax</TableHead>
                <TableHead className="w-40">Project</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Select value={l.category_id} onValueChange={(v) => pickCategory(i, v)}>
                      <SelectTrigger><SelectValue placeholder="Pick category…" /></SelectTrigger>
                      <SelectContent>
                        {(categories ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={l.gl_account_id} onValueChange={(v) => setLine(i, { gl_account_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select account…" /></SelectTrigger>
                      <SelectContent>
                        {(glAccounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} /></TableCell>
                  <TableCell>
                    <Select value={l.tax_code_id} onValueChange={(v) => setLine(i, { tax_code_id: v })}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        {(taxCodes ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.code} ({t.rate}%)</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={l.project_id} onValueChange={(v) => setLine(i, { project_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Header" /></SelectTrigger>
                      <SelectContent>
                        {(projects ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm">
          <Button variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine()])}>
            <Plus className="h-3 w-3 mr-1" />Add line
          </Button>
          <div className="space-x-4 font-mono">
            <span>Subtotal: {fmtMoney(totals.sub, currency)}</span>
            <span>Tax: {fmtMoney(totals.tax, currency)}</span>
            <span className="font-semibold">Total: {fmtMoney(totals.total, currency)}</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="flex items-center gap-1"><Upload className="h-3 w-3" />Supplier invoices / receipts</Label>
            <Input type="file" multiple accept="image/*,application/pdf" onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setExtracted(null); }} />
            {!!files.length && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">{files.length} file(s) — originals are kept in the audit trail.</p>
                <Button variant="outline" size="sm" onClick={scanFirstFile} disabled={scanning}>
                  <ScanLine className={`h-3 w-3 mr-1 ${scanning ? "animate-pulse" : ""}`} />
                  {scanning ? "Reading document…" : "Scan with AI"}
                </Button>
              </div>
            )}
          </div>
          <div><Label>Notes</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>

        {extracted && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">Extracted from {files[0]?.name}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setExtracted(null)}>Discard</Button>
                <Button size="sm" onClick={applyExtraction}>Apply to form</Button>
              </div>
            </div>
            <div className="grid gap-1 sm:grid-cols-3 text-xs">
              <span>Vendor: <b>{extracted.vendor_name ?? "—"}</b></span>
              <span>Invoice no: <b>{extracted.invoice_number ?? "—"}</b></span>
              <span>Date: <b>{extracted.invoice_date ?? "—"}</b></span>
              <span>Due: <b>{extracted.due_date ?? "—"}</b></span>
              <span>Currency: <b>{extracted.currency ?? "—"}</b></span>
              <span>Total: <b>{extracted.total_amount ?? "—"}</b></span>
            </div>
            {!!extracted.lines?.length && (
              <ul className="text-xs list-disc pl-4">
                {extracted.lines.map((l: any, i: number) => (
                  <li key={i}>{l.description} — {l.amount}</li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">Review every figure before submitting — extraction is a helper, not a substitute for checking the document.</p>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!submitOnly && (
            <Button variant="secondary" onClick={() => save.mutate(false)} disabled={!valid || save.isPending}>
              Save as draft
            </Button>
          )}
          <Button onClick={() => save.mutate(true)} disabled={!valid || save.isPending}>
            {save.isPending ? "Saving…" : "Submit for approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
