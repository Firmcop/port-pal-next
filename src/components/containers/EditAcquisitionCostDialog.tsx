import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { CurrencySelect } from "@/components/CurrencySelect";
import SupplierCombobox from "@/components/suppliers/SupplierCombobox";
import FxRateInput from "@/components/containers/FxRateInput";
import { useToast } from "@/hooks/use-toast";
import { useAppSettings } from "@/hooks/use-app-settings";
import { useOrganization } from "@/hooks/use-organization";
import {
  previewAcquisitionCosts,
  setContainerAcquisitionCosts,
} from "@/lib/container-acquisition-edit";
import AcquisitionPreviewList from "@/components/containers/AcquisitionPreviewList";
import { ACQ_REASONS, isVoidInvoice, type AcqInvoice } from "@/lib/acquisition-costs";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/app-settings";


const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Admin-only editor for a container's full acquisition cost. Each of the three
 * components (seller price, transport, crane / offloading) keeps its own
 * currency, is created / adjusted / cancelled server-side, and is reviewed in a
 * confirmation step before anything is written.
 */
export default function EditAcquisitionCostDialog({
  open,
  onOpenChange,
  containerId,
  containerNumber,
  invoices = [],
  containerRow,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  containerId: string;
  containerNumber?: string | null;
  invoices?: AcqInvoice[];
  containerRow?: {
    transport_vendor?: string | null;
    offloading_vendor?: string | null;
    acquisition_currency?: string | null;
    transport_currency?: string | null;
    offloading_currency?: string | null;
  } | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currency: orgCurrency } = useAppSettings();
  const { organizationId } = useOrganization();

  // Split children inherit their cost from the mother unit — they can never
  // carry acquisition invoices of their own, so the editor is read-only.
  const { data: splitChild } = useQuery({
    queryKey: ["container-split-parent", containerId],
    enabled: open && !!containerId,
    queryFn: async () => {
      const { data } = await supabase
        .from("containers")
        .select("parent_container_id, acquisition_cost")
        .eq("id", containerId)
        .maybeSingle();
      if (!data?.parent_container_id) return null;
      const { data: mother } = await supabase
        .from("containers")
        .select("container_number")
        .eq("id", data.parent_container_id)
        .maybeSingle();
      return {
        motherNumber: mother?.container_number ?? null,
        share: formatMoney(Number(data.acquisition_cost ?? 0), orgCurrency),
      };
    },
  });



  const [step, setStep] = useState<"edit" | "review">("edit");
  const [purchase, setPurchase] = useState("");
  const [purchaseCurrency, setPurchaseCurrency] = useState(orgCurrency);
  const [purchaseFx, setPurchaseFx] = useState("");
  const [transport, setTransport] = useState("");
  const [transportVendor, setTransportVendor] = useState("");
  const [transportSupplierId, setTransportSupplierId] = useState<string | null>(null);
  const [transportCurrency, setTransportCurrency] = useState(orgCurrency);
  const [transportFx, setTransportFx] = useState("");
  const [offloading, setOffloading] = useState("");
  const [offloadingVendor, setOffloadingVendor] = useState("");
  const [offloadingSupplierId, setOffloadingSupplierId] = useState<string | null>(null);
  const [offloadingCurrency, setOffloadingCurrency] = useState(orgCurrency);
  const [offloadingFx, setOffloadingFx] = useState("");
  const [reason, setReason] = useState("");
  const [ackWarnings, setAckWarnings] = useState(false);

  useEffect(() => {
    if (!open) return;
    const live = invoices.filter((i) => !isVoidInvoice(i));
    const find = (r: string) => live.find((i) => i.reason === r);
    const p = find(ACQ_REASONS[0]);
    const t = find(ACQ_REASONS[1]);
    const c = find(ACQ_REASONS[2]);
    setPurchase(p ? String(num(p.total_amount)) : "");
    setTransport(t ? String(num(t.total_amount)) : "");
    setOffloading(c ? String(num(c.total_amount)) : "");
    setTransportVendor(t?.suppliers?.name ?? containerRow?.transport_vendor ?? "");
    setOffloadingVendor(c?.suppliers?.name ?? containerRow?.offloading_vendor ?? "");
    setTransportSupplierId(null);
    setOffloadingSupplierId(null);
    setPurchaseCurrency((p?.currency || containerRow?.acquisition_currency || orgCurrency) as string);
    setTransportCurrency((t?.currency || containerRow?.transport_currency || orgCurrency) as string);
    setOffloadingCurrency((c?.currency || containerRow?.offloading_currency || orgCurrency) as string);
    setPurchaseFx("");
    setTransportFx("");
    setOffloadingFx("");
    setReason("");
    setStep("edit");
    setAckWarnings(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, containerId]);

  const previewInput = {
    containerId,
    purchase: num(purchase),
    purchaseCurrency,
    purchaseFx: num(purchaseFx) || null,
    transport: num(transport),
    transportVendor,
    transportCurrency,
    transportFx: num(transportFx) || null,
    offloading: num(offloading),
    offloadingVendor,
    offloadingCurrency,
    offloadingFx: num(offloadingFx) || null,
  };

  const {
    data: preview,
    isFetching: previewLoading,
    error: previewError,
  } = useQuery({
    queryKey: ["acq-preview", containerId, JSON.stringify(previewInput)],
    enabled: open && step === "review",
    queryFn: () => previewAcquisitionCosts(previewInput),
  });

  const blocked = (preview?.blockers ?? []).length > 0;
  const needsAck = (preview?.warnings ?? []).length > 0 && !ackWarnings;

  const mut = useMutation({
    mutationFn: () =>
      setContainerAcquisitionCosts({
        containerId,
        purchase: num(purchase),
        purchaseCurrency,
        purchaseFx: num(purchaseFx) || null,
        transport: num(transport),
        transportVendor,
        transportSupplierId,
        transportCurrency,
        transportFx: num(transportFx) || null,
        offloading: num(offloading),
        offloadingVendor,
        offloadingSupplierId,
        offloadingCurrency,
        offloadingFx: num(offloadingFx) || null,
        currency: purchaseCurrency,
        reason,
      }),

    onSuccess: (res) => {
      const changed = Object.entries(res ?? {})
        .filter(([, v]: any) => v?.outcome && v.outcome !== "unchanged")
        .map(([k, v]: any) => `${k.replace("acquisition_", "").replace(/_/g, " ")}: ${v.outcome}`);
      toast({
        title: "Acquisition cost updated",
        description: changed.length ? changed.join(" · ") : "No invoice changes were needed",
      });
      qc.invalidateQueries({ queryKey: ["container-acquisition-invoices", containerId] });
      qc.invalidateQueries({ queryKey: ["container-acquisition-breakdown"] });
      qc.invalidateQueries({ queryKey: ["container-acquisition-audit", containerId] });
      qc.invalidateQueries({ queryKey: ["containers"] });
      qc.invalidateQueries({ queryKey: ["container"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totals = new Map<string, number>();
  for (const [amt, code] of [
    [num(purchase), purchaseCurrency],
    [num(transport), transportCurrency],
    [num(offloading), offloadingCurrency],
  ] as [number, string][]) {
    if (amt > 0) totals.set(code.toUpperCase(), (totals.get(code.toUpperCase()) ?? 0) + amt);
  }

  if (splitChild) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Cost is inherited{containerNumber ? ` — ${containerNumber}` : ""}</DialogTitle>
            <DialogDescription>
              This unit came out of a container split, so it has no acquisition cost of its own.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border p-3 text-sm space-y-2">
            <p>
              Cost inherited from the split of{" "}
              <span className="font-mono">{splitChild.motherNumber ?? "the mother unit"}</span> — its share of that
              container's purchase price and transport &amp; crane, apportioned by size.
            </p>
            <p className="font-semibold">Allocated cost: {splitChild.share}</p>
            <p className="text-xs text-muted-foreground">
              No gate-in, transport or crane invoice can be raised against a split child. Change the mother unit's
              acquisition cost or restate the cost shares on the split job instead.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>

      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "edit" ? "Edit acquisition cost" : "Review changes"}
            {containerNumber ? ` — ${containerNumber}` : ""}
          </DialogTitle>
          <DialogDescription>
            {step === "edit"
              ? "Each component keeps its own vendor and currency: a new amount raises or adjusts its purchase invoice, zero cancels it."
              : "These are the exact invoice and ledger changes that will be applied."}
          </DialogDescription>
        </DialogHeader>

        {step === "edit" ? (
          <div className="space-y-4">
            <div className="space-y-2 rounded-md border p-3">
              <Label>Seller (purchase price)</Label>
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
              <p className="text-xs text-muted-foreground">Invoiced to the container's registered owner.</p>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <Label>Transport / delivery</Label>
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
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <Label>Crane / offloading</Label>
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
            </div>


            <p className="text-xs text-muted-foreground">
              Total acquisition cost:{" "}
              <strong>
                {totals.size === 0
                  ? "—"
                  : Array.from(totals.entries())
                      .map(([c, a]) => `${c} ${a.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
                      .join(" · ")}
              </strong>
            </p>

            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the cost being corrected?" className="h-20" />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {previewLoading && <p className="text-sm text-muted-foreground">Checking invoices and exchange rates…</p>}
            {previewError && (
              <p className="text-sm text-destructive">{(previewError as any)?.message ?? "Preview failed"}</p>
            )}
            {preview && <AcquisitionPreviewList preview={preview} />}
            {preview && (preview.warnings ?? []).length > 0 && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={ackWarnings} onChange={(e) => setAckWarnings(e.target.checked)} />
                I understand the warnings above and want to continue.
              </label>
            )}
            <p className="text-xs text-muted-foreground">Reason: {reason}</p>
          </div>
        )}

        <DialogFooter>
          {step === "edit" ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => setStep("review")} disabled={!reason.trim()}>Review changes</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep("edit")} disabled={mut.isPending}>Back</Button>
              <Button
                onClick={() => mut.mutate()}
                disabled={mut.isPending || previewLoading || blocked || needsAck || !preview}
              >
                {mut.isPending ? "Saving…" : blocked ? "Fix problems to save" : "Confirm & save"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
