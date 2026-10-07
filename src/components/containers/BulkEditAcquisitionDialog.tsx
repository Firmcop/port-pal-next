import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Download, Upload } from "lucide-react";
import { CurrencySelect } from "@/components/CurrencySelect";
import SupplierCombobox from "@/components/suppliers/SupplierCombobox";
import FxRateInput from "@/components/containers/FxRateInput";
import { useToast } from "@/hooks/use-toast";
import { useAppSettings } from "@/hooks/use-app-settings";
import { useOrganization } from "@/hooks/use-organization";
import {
  previewAcquisitionCosts,
  setAcquisitionCostsBulk,
  type AcqPreview,
  type BulkEditResult,
} from "@/lib/container-acquisition-edit";
import {
  applyAcquisitionCsv,
  downloadAcquisitionCsvErrors,
  downloadAcquisitionCsvTemplate,
  parseAcquisitionCsv,
  type AcqCsvRow,
} from "@/lib/acquisition-csv";
import AcquisitionPreviewList from "@/components/containers/AcquisitionPreviewList";


const num = (v: string) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};


/**
 * Apply the same acquisition-cost edit to several containers at once, with one
 * reason for all of them. Every container is previewed first and containers
 * with blocking problems are skipped rather than partly written.
 */
export default function BulkEditAcquisitionDialog({
  open,
  onOpenChange,
  containers,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  containers: { id: string; container_number?: string | null }[];
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currency: orgCurrency } = useAppSettings();
  const { organizationId } = useOrganization();

  const [step, setStep] = useState<"edit" | "review" | "done">("edit");
  const [applyPurchase, setApplyPurchase] = useState(false);
  const [purchase, setPurchase] = useState("");
  const [purchaseCurrency, setPurchaseCurrency] = useState(orgCurrency);
  const [purchaseFx, setPurchaseFx] = useState("");
  const [applyTransport, setApplyTransport] = useState(true);
  const [transport, setTransport] = useState("");
  const [transportVendor, setTransportVendor] = useState("");
  const [transportSupplierId, setTransportSupplierId] = useState<string | null>(null);
  const [transportCurrency, setTransportCurrency] = useState(orgCurrency);
  const [transportFx, setTransportFx] = useState("");
  const [applyOffloading, setApplyOffloading] = useState(true);
  const [offloading, setOffloading] = useState("");
  const [offloadingVendor, setOffloadingVendor] = useState("");
  const [offloadingSupplierId, setOffloadingSupplierId] = useState<string | null>(null);
  const [offloadingCurrency, setOffloadingCurrency] = useState(orgCurrency);
  const [offloadingFx, setOffloadingFx] = useState("");
  const [reason, setReason] = useState("");
  const [previews, setPreviews] = useState<{ preview: AcqPreview | null; error?: string; number?: string | null }[]>([]);
  const [results, setResults] = useState<BulkEditResult[]>([]);
  const [mode, setMode] = useState<"manual" | "csv">("manual");
  const [csvRows, setCsvRows] = useState<AcqCsvRow[]>([]);
  const [csvName, setCsvName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep("edit");
    setPreviews([]);
    setResults([]);
    setReason("");
    setMode("manual");
    setCsvRows([]);
    setCsvName("");
    setPurchaseCurrency(orgCurrency);
    setTransportCurrency(orgCurrency);
    setOffloadingCurrency(orgCurrency);
    setPurchaseFx("");
    setTransportFx("");
    setOffloadingFx("");
    setTransportSupplierId(null);
    setOffloadingSupplierId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);


  const csvParse = useMutation({
    mutationFn: async (file: File) => parseAcquisitionCsv(await file.text(), orgCurrency),
    onSuccess: (rows) => {
      setCsvRows(rows);
      if (rows.length === 0) toast({ title: "No data rows found in the file", variant: "destructive" });
    },
    onError: (e: any) => toast({ title: "Could not read the file", description: e.message, variant: "destructive" }),
  });

  const csvApply = useMutation({
    mutationFn: () => applyAcquisitionCsv(csvRows, reason),
    onSuccess: (res) => {
      setResults(res);
      setStep("done");
      const applied = res.filter((r) => r.status === "applied").length;
      toast({ title: `Updated ${applied} of ${res.length} containers` });
      qc.invalidateQueries({ queryKey: ["containers"] });
      qc.invalidateQueries({ queryKey: ["container-acquisition-breakdown"] });
      onDone?.();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const csvOk = csvRows.filter((r) => !r.error && (r.blockers?.length ?? 0) === 0);
  const csvBad = csvRows.filter((r) => r.error || (r.blockers?.length ?? 0) > 0);


  const buildInput = () => ({
    purchase: applyPurchase ? num(purchase) : undefined,
    purchaseCurrency,
    purchaseFx: applyPurchase ? num(purchaseFx) || null : null,
    transport: applyTransport ? num(transport) : undefined,
    transportVendor: applyTransport ? transportVendor : undefined,
    transportCurrency,
    transportFx: applyTransport ? num(transportFx) || null : null,
    offloading: applyOffloading ? num(offloading) : undefined,
    offloadingVendor: applyOffloading ? offloadingVendor : undefined,
    offloadingCurrency,
    offloadingFx: applyOffloading ? num(offloadingFx) || null : null,
  });

  const previewMut = useMutation({
    mutationFn: async () => {
      const input = buildInput();
      const out: { preview: AcqPreview | null; error?: string; number?: string | null }[] = [];
      for (const c of containers.slice(0, 25)) {
        try {
          out.push({
            preview: await previewAcquisitionCosts({ containerId: c.id, ...input }),
            number: c.container_number,
          });
        } catch (e: any) {
          out.push({ preview: null, error: e?.message ?? "Preview failed", number: c.container_number });
        }
      }
      return out;
    },
    onSuccess: (out) => {
      setPreviews(out);
      setStep("review");
    },
    onError: (e: any) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const applyMut = useMutation({
    mutationFn: () => {
      const input = buildInput();
      return setAcquisitionCostsBulk(containers, {
        purchase: input.purchase ?? 0,
        purchaseCurrency,
        purchaseFx: input.purchaseFx,
        transport: input.transport ?? 0,
        transportVendor: input.transportVendor ?? null,
        transportSupplierId,
        transportCurrency,
        transportFx: input.transportFx,
        offloading: input.offloading ?? 0,
        offloadingVendor: input.offloadingVendor ?? null,
        offloadingSupplierId,
        offloadingCurrency,
        offloadingFx: input.offloadingFx,
        currency: purchaseCurrency,
        reason,
      });
    },

    onSuccess: (res) => {
      setResults(res);
      setStep("done");
      const applied = res.filter((r) => r.status === "applied").length;
      toast({
        title: `Updated ${applied} of ${res.length} containers`,
        description: res.length - applied > 0 ? `${res.length - applied} skipped or failed — see the list.` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["containers"] });
      qc.invalidateQueries({ queryKey: ["container-acquisition-breakdown"] });
      onDone?.();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const blockedCount = previews.filter((p) => (p.preview?.blockers ?? []).length > 0 || p.error).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit acquisition costs — {containers.length} containers</DialogTitle>
          <DialogDescription>
            The same amounts, vendors and currencies are applied to every selected container, with one reason recorded
            on each.
          </DialogDescription>
        </DialogHeader>

        {step === "edit" && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as "manual" | "csv")} className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">Same values for all</TabsTrigger>
              <TabsTrigger value="csv">Import from CSV</TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="space-y-4">
            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={applyPurchase} onChange={(e) => setApplyPurchase(e.target.checked)} />
                Set seller (purchase price)
              </label>
              {applyPurchase && (
                <>
                  <div className="grid grid-cols-[1fr_130px] gap-3">
                    <Input type="number" min="0" value={purchase} onChange={(e) => setPurchase(e.target.value)} placeholder="0" />
                    <CurrencySelect value={purchaseCurrency} onChange={setPurchaseCurrency} />
                  </div>
                  <FxRateInput
                    amount={num(purchase)}
                    currency={purchaseCurrency}
                    baseCurrency={orgCurrency}
                    value={purchaseFx}
                    onChange={setPurchaseFx}
                    organizationId={organizationId}
                  />
                </>
              )}
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={applyTransport} onChange={(e) => setApplyTransport(e.target.checked)} />
                Set transport / delivery
              </label>
              {applyTransport && (
                <>
                  <div className="grid grid-cols-[1fr_130px] gap-3">
                    <Input type="number" min="0" value={transport} onChange={(e) => setTransport(e.target.value)} placeholder="0" />
                    <CurrencySelect value={transportCurrency} onChange={setTransportCurrency} />
                  </div>
                  <SupplierCombobox
                    value={transportVendor}
                    onChange={(name, id) => { setTransportVendor(name); setTransportSupplierId(id ?? null); }}
                    placeholder="Select transporter"
                  />
                  <FxRateInput
                    amount={num(transport)}
                    currency={transportCurrency}
                    baseCurrency={orgCurrency}
                    value={transportFx}
                    onChange={setTransportFx}
                    organizationId={organizationId}
                  />
                </>
              )}
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={applyOffloading} onChange={(e) => setApplyOffloading(e.target.checked)} />
                Set crane / offloading
              </label>
              {applyOffloading && (
                <>
                  <div className="grid grid-cols-[1fr_130px] gap-3">
                    <Input type="number" min="0" value={offloading} onChange={(e) => setOffloading(e.target.value)} placeholder="0" />
                    <CurrencySelect value={offloadingCurrency} onChange={setOffloadingCurrency} />
                  </div>
                  <SupplierCombobox
                    value={offloadingVendor}
                    onChange={(name, id) => { setOffloadingVendor(name); setOffloadingSupplierId(id ?? null); }}
                    placeholder="Select crane vendor"
                  />
                  <FxRateInput
                    amount={num(offloading)}
                    currency={offloadingCurrency}
                    baseCurrency={orgCurrency}
                    value={offloadingFx}
                    onChange={setOffloadingFx}
                    organizationId={organizationId}
                  />
                </>
              )}
            </div>


            <p className="text-xs text-muted-foreground">
              Components left unticked are set to zero, which cancels their invoice — tick a component only when you
              want it applied to every selected container.
            </p>
            </TabsContent>

            <TabsContent value="csv" className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Give each container its own amounts, currencies and vendors. Every row is checked against the same
                rules as a manual edit before anything is saved.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadAcquisitionCsvTemplate(orgCurrency)}>
                  <Download className="h-3.5 w-3.5 mr-1" />Download template
                </Button>
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={csvParse.isPending}>
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  {csvParse.isPending ? "Checking…" : "Choose CSV file"}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setCsvName(f.name);
                      csvParse.mutate(f);
                    }
                    e.target.value = "";
                  }}
                />
              </div>
              {csvName && <p className="text-xs text-muted-foreground">{csvName}</p>}

              {csvRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm">
                    {csvOk.length} row{csvOk.length === 1 ? "" : "s"} ready
                    {csvBad.length > 0 && <span className="text-destructive"> · {csvBad.length} will be skipped</span>}
                  </p>
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {csvRows.map((r, i) => (
                      <div key={i} className="rounded-md border p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-medium">{r.containerNumber || "(blank)"}</span>
                          <Badge
                            variant="outline"
                            className={
                              r.error || (r.blockers?.length ?? 0) > 0
                                ? "bg-destructive/10 text-destructive border-destructive/30"
                                : "bg-emerald-500/15 text-emerald-700 border-emerald-300"
                            }
                          >
                            {r.error || (r.blockers?.length ?? 0) > 0 ? "skip" : "ready"}
                          </Badge>
                        </div>
                        {r.error && <div className="text-xs text-destructive">{r.error}</div>}
                        {(r.blockers ?? []).map((b, k) => (
                          <div key={k} className="text-xs text-destructive">{b}</div>
                        ))}
                        {!r.error && r.preview && <AcquisitionPreviewList preview={r.preview} />}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are these costs being corrected?" className="h-20" />
            </div>
          </Tabs>
        )}


        {step === "review" && (
          <div className="space-y-3">
            <p className="text-sm">
              Previewed {previews.length} of {containers.length} containers.{" "}
              {blockedCount > 0 && (
                <span className="text-destructive">{blockedCount} will be skipped due to blocking problems.</span>
              )}
            </p>
            {previews.map((p, i) => (
              <div key={i} className="space-y-1">
                <div className="text-xs font-mono font-medium">{p.number ?? p.preview?.container_number}</div>
                {p.error ? (
                  <div className="text-xs text-destructive">{p.error}</div>
                ) : (
                  p.preview && <AcquisitionPreviewList preview={p.preview} />
                )}
              </div>
            ))}
            {containers.length > previews.length && (
              <p className="text-xs text-muted-foreground">
                Only the first {previews.length} are previewed; all {containers.length} are validated again on save.
              </p>
            )}
          </div>
        )}

        {step === "done" && (
          <div className="space-y-2 text-sm">
            {results.some((r) => r.status !== "applied") && (
              <Button variant="outline" size="sm" onClick={() => downloadAcquisitionCsvErrors(results)}>
                <Download className="h-3.5 w-3.5 mr-1" />Download skipped rows
              </Button>
            )}
            {results.map((r) => (
              <div key={r.containerId} className="flex items-start justify-between gap-2 rounded-md border p-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-medium">{r.containerNumber ?? r.containerId}</div>
                  <div className="text-xs text-muted-foreground">{r.detail}</div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    r.status === "applied"
                      ? "bg-emerald-500/15 text-emerald-700 border-emerald-300"
                      : r.status === "skipped"
                        ? "bg-amber-500/15 text-amber-700 border-amber-300"
                        : "bg-destructive/10 text-destructive border-destructive/30"
                  }
                >
                  {r.status}
                </Badge>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          {step === "edit" && mode === "manual" && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => previewMut.mutate()} disabled={!reason.trim() || previewMut.isPending}>
                {previewMut.isPending ? "Checking…" : "Review changes"}
              </Button>
            </>
          )}
          {step === "edit" && mode === "csv" && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                onClick={() => csvApply.mutate()}
                disabled={!reason.trim() || csvOk.length === 0 || csvApply.isPending}
              >
                {csvApply.isPending ? "Applying…" : `Apply to ${csvOk.length} containers`}
              </Button>
            </>
          )}
          {step === "review" && (
            <>
              <Button variant="ghost" onClick={() => setStep("edit")} disabled={applyMut.isPending}>Back</Button>
              <Button onClick={() => applyMut.mutate()} disabled={applyMut.isPending}>
                {applyMut.isPending ? "Applying…" : `Apply to ${containers.length} containers`}
              </Button>
            </>
          )}
          {step === "done" && <Button onClick={() => onOpenChange(false)}>Close</Button>}
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}
