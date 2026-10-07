import { AlertTriangle, ArrowRight, Ban, Info, Plus, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ACQ_LABELS, type AcqReason } from "@/lib/acquisition-costs";
import type { AcqPreview, AcqPreviewComponent } from "@/lib/container-acquisition-edit";

const fmt = (n: number, c: string) =>
  `${c} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ACTION_TONE: Record<string, string> = {
  create: "bg-emerald-500/15 text-emerald-700 border-emerald-300",
  adjust: "bg-amber-500/15 text-amber-700 border-amber-300",
  cancel: "bg-destructive/10 text-destructive border-destructive/30",
  unchanged: "bg-muted text-muted-foreground",
};

function Row({ c }: { c: AcqPreviewComponent }) {
  const label = ACQ_LABELS[c.component as AcqReason] ?? c.component;
  return (
    <div className="rounded-md border p-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">{label}</span>
        <Badge variant="outline" className={ACTION_TONE[c.action] ?? ""}>
          {c.action === "unchanged" ? "no change" : c.action}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground">
        {c.invoice_number ? `Invoice ${c.invoice_number}` : "New invoice"}
        {c.vendor ? ` · ${c.vendor}` : ""}
      </div>
      {c.action !== "unchanged" && (
        <div className="flex items-center gap-2 text-xs">
          <span className="line-through text-muted-foreground">
            {fmt(c.old_amount, (c.old_currency || c.currency).toUpperCase())}
          </span>
          <ArrowRight className="h-3 w-3" />
          <span className="font-medium">
            {c.action === "cancel" ? "cancelled" : fmt(c.new_amount, c.currency)}
          </span>
        </div>
      )}
      {c.action !== "cancel" && c.fx_rate != null && c.base_currency && c.currency !== c.base_currency && (
        <div className="text-xs text-muted-foreground">
          {fmt(c.new_amount, c.currency)} x {Number(c.fx_rate).toLocaleString(undefined, { maximumFractionDigits: 6 })} ={" "}
          {fmt(Number(c.base_amount ?? 0), c.base_currency)}
          {c.fx_rate_date ? ` (rate of ${new Date(c.fx_rate_date).toLocaleDateString()})` : ""}
        </div>
      )}
      {c.action !== "cancel" && c.invoice_number && c.old_currency &&
        c.old_currency.toUpperCase() !== c.currency.toUpperCase() && (
        <div className="text-xs text-warning">
          Invoice currency changes from {c.old_currency.toUpperCase()} to {c.currency.toUpperCase()} — this is recorded in the
          invoice currency change history.
        </div>
      )}



      {c.ledger && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {c.delta >= 0 ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          {c.ledger}
          {c.purchase_order_id ? " · linked PO total updated" : ""}
        </div>
      )}
    </div>
  );
}

/**
 * Confirmation preview: exactly which invoices, ledger entries and POs an
 * acquisition-cost edit will touch, plus blocking problems and warnings.
 */
export default function AcquisitionPreviewList({ preview }: { preview: AcqPreview }) {
  const changed = (preview.components ?? []).filter((c) => c.action !== "unchanged");
  return (
    <div className="space-y-3">
      {(preview.blockers ?? []).length > 0 && (
        <div className="space-y-2">
          {preview.blockers.map((b, i) => (
            <div key={i} className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
              <Ban className="h-4 w-4 shrink-0 text-destructive" />
              <div>
                <div className="font-medium text-destructive">{b.message}</div>
                <div className="text-muted-foreground">{b.fix}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(preview.warnings ?? []).length > 0 && (
        <div className="space-y-2">
          {preview.warnings.map((w, i) => (
            <div key={i} className="flex gap-2 rounded-md border border-amber-400/50 bg-amber-500/5 p-2 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <div className="font-medium">{w.message}</div>
                <div className="text-muted-foreground">{w.fix}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {changed.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border p-2 text-xs text-muted-foreground">
          <Info className="h-4 w-4" /> Nothing would change for this container.
        </div>
      ) : (
        <div className="space-y-2">
          {changed.map((c) => (
            <Row key={c.component} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}
