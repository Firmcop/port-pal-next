import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, ExternalLink, Undo2, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { formatMoneyCode } from "@/lib/money";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";

type AuditRow = {
  invoice_id: string;
  invoice_number: string;
  container_id: string;
  container_number: string;
  supplier_name: string | null;
  reason: string;
  reference: string | null;
  total_amount: number;
  currency: string;
  status: string;
  paid_amount: number | null;
  created_at: string;
  issue: "repeat_invoice" | "already_purchased";
  keeps_invoice: string | null;
};

const ISSUE_META: Record<string, { label: string; hint: string; className: string }> = {
  repeat_invoice: {
    label: "Repeat invoice",
    hint: "Same container, same purpose and reference invoiced more than once.",
    className: "bg-destructive/15 text-destructive",
  },
  already_purchased: {
    label: "Already purchased",
    hint: "Container already carries a purchase acquisition invoice; this second liability is redundant.",
    className: "bg-warning/15 text-warning",
  },
};

export default function AcquisitionDuplicates() {
  const qc = useQueryClient();
  const { isOwnerOrAdmin } = useUserStaffRole();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("Duplicate acquisition liability — one acquisition invoice per container.");
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["duplicate-acquisition-audit"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("duplicate_acquisition_audit" as any);
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  const rows = data ?? [];
  const selectedRows = useMemo(
    () => rows.filter((r) => selected[r.invoice_id] && Number(r.paid_amount ?? 0) === 0),
    [rows, selected],
  );

  const totalsByCurrency = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of selectedRows) m[r.currency] = (m[r.currency] ?? 0) + Number(r.total_amount || 0);
    return m;
  }, [selectedRows]);

  async function reverseSelected() {
    if (!selectedRows.length) return;
    if (!reason.trim()) return toast.error("A reason is required");
    setBusy(true);
    let ok = 0;
    const errors: string[] = [];
    for (const r of selectedRows) {
      const { error } = await supabase.rpc("reverse_duplicate_acquisition_invoice" as any, {
        _invoice_id: r.invoice_id,
        _reason: reason.trim(),
      });
      if (error) errors.push(`${r.invoice_number}: ${error.message}`);
      else ok += 1;
    }
    setBusy(false);
    setSelected({});
    qc.invalidateQueries({ queryKey: ["duplicate-acquisition-audit"] });
    qc.invalidateQueries({ queryKey: ["supplier-invoices"] });
    if (ok) toast.success(`${ok} invoice${ok === 1 ? "" : "s"} reversed`);
    if (errors.length) toast.error(errors.slice(0, 3).join(" · "));
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Duplicate acquisition invoices</h1>
        <p className="text-sm text-muted-foreground">
          One acquisition liability per container. This audit lists purchase invoices that duplicate an
          existing acquisition — reversing one cancels the invoice and its purchase order and posts a
          contra entry. Nothing is deleted.
        </p>
      </div>

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Prevention is live</AlertTitle>
        <AlertDescription>
          Selling, gating out or converting a container that already has a purchase invoice no longer raises a
          second invoice — the existing purchase order is reused instead.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" /> Findings
            <Badge variant="outline">{rows.length}</Badge>
          </CardTitle>
          <CardDescription>Only unpaid invoices can be reversed here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No duplicate acquisition invoices found.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Container</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead>Issue</TableHead>
                      <TableHead>Keeps</TableHead>
                      <TableHead>Raised</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const paid = Number(r.paid_amount ?? 0) > 0;
                      const meta = ISSUE_META[r.issue] ?? ISSUE_META.repeat_invoice;
                      return (
                        <TableRow key={r.invoice_id}>
                          <TableCell>
                            <Checkbox
                              checked={!!selected[r.invoice_id]}
                              disabled={paid || !isOwnerOrAdmin}
                              onCheckedChange={(v) =>
                                setSelected((s) => ({ ...s, [r.invoice_id]: !!v }))
                              }
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.container_number}</TableCell>
                          <TableCell>
                            <Link
                              to={`/finance/supplier-invoices?invoice=${r.invoice_id}`}
                              className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1"
                            >
                              {r.invoice_number} <ExternalLink className="h-3 w-3" />
                            </Link>
                            {r.reference && (
                              <div className="text-[11px] text-muted-foreground">Ref {r.reference}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{r.supplier_name ?? "—"}</TableCell>
                          <TableCell className="capitalize text-sm">{r.reason.replace(/_/g, " ")}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={meta.className} title={meta.hint}>
                              {meta.label}
                            </Badge>
                            {paid && (
                              <div className="text-[11px] text-muted-foreground">Has payments — settle first</div>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {r.keeps_invoice ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.created_at ? format(new Date(r.created_at), "PP") : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatMoneyCode(Number(r.total_amount), r.currency)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {isOwnerOrAdmin && (
                <div className="space-y-3 rounded-md border p-4">
                  <div className="text-sm font-medium">
                    Reverse {selectedRows.length} selected
                    {Object.keys(totalsByCurrency).length > 0 && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {Object.entries(totalsByCurrency)
                          .map(([c, v]) => formatMoneyCode(v, c))
                          .join(" · ")}
                      </span>
                    )}
                  </div>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason recorded on the invoice and in the finance audit log"
                    rows={2}
                  />
                  <Button
                    onClick={reverseSelected}
                    disabled={busy || selectedRows.length === 0 || !reason.trim()}
                    variant="destructive"
                  >
                    <Undo2 className="mr-2 h-4 w-4" />
                    {busy ? "Reversing…" : "Reverse selected"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
