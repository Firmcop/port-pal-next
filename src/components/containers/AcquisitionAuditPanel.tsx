import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download } from "lucide-react";
import { format } from "date-fns";
import { exportCSV, exportPDF } from "@/lib/export-utils";
import { ACQ_LABELS, type AcqReason } from "@/lib/acquisition-costs";

const ACTIONS = [
  "container_acquisition_cost_edit",
  "container_acquisition_override",
  "container_acquisition_fx_revaluation",
];

const fmt = (n: unknown, c?: string | null) =>
  `${(c || "").toUpperCase()} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`.trim();


interface AuditRow {
  id: string;
  created_at: string;
  actor_email: string | null;
  entity_type: string;
  entity_ref: string | null;
  action: string;
  summary: any;
  before_data: any;
  after_data: any;
}

/**
 * Full history of acquisition-cost edits and intake overrides for one
 * container: who, when, which component, before/after and the reason.
 */
export default function AcquisitionAuditPanel({
  containerId,
  containerNumber,
  className,
}: {
  containerId: string;
  containerNumber?: string | null;
  className?: string;
}) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["container-acquisition-audit", containerId],
    enabled: !!containerId,
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await supabase
        .from("finance_audit_log")
        .select("id, created_at, actor_email, entity_type, entity_ref, action, summary, before_data, after_data")
        .in("action", ACTIONS)
        .or(`entity_id.eq.${containerId},summary->>container_id.eq.${containerId}`)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  const detailRows = rows.filter((r) => r.entity_type !== "containers" || r.action === "container_acquisition_override");

  const HEADERS = [
    "Date", "User", "Component", "Action", "Before", "After", "Base delta",
    "FX rate", "Invoice", "Ledger", "Reason",
  ];

  const exportRows = () =>
    detailRows.map((r) => {
      const component = r.summary?.component as AcqReason | undefined;
      const b = r.before_data ?? {};
      const a = r.after_data ?? {};
      const baseDelta =
        a.base_amount != null || b.base_amount != null
          ? fmt(Number(a.base_amount ?? 0) - Number(b.base_amount ?? 0), r.summary?.base_currency)
          : "";
      return [
        format(new Date(r.created_at), "yyyy-MM-dd HH:mm"),
        r.actor_email ?? "System",
        component ? ACQ_LABELS[component] ?? component : "Acquisition cost",
        String(r.summary?.outcome ?? r.action.replace("container_acquisition_", "")).replace(/_/g, " "),
        b.total_amount != null ? fmt(b.total_amount, b.currency) : "",
        a.total_amount != null ? fmt(a.total_amount, a.currency) : "",
        baseDelta,
        a.fx_rate != null ? Number(a.fx_rate).toFixed(6) : "",
        r.entity_ref ?? "",
        r.summary?.ledger ?? "",
        r.summary?.reason ?? "",
      ];
    });

  const base = `acquisition-history-${containerNumber ?? "container"}`;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Acquisition cost history</CardTitle>
            <CardDescription>
              Every edit, revaluation and intake override for {containerNumber ?? "this container"} — who, when, before
              and after, and why.
            </CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={detailRows.length === 0}>
                <Download className="h-3.5 w-3.5 mr-1" />Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportCSV(`${base}.csv`, HEADERS, exportRows())}>
                Download CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  exportPDF(
                    `Acquisition cost history — ${containerNumber ?? ""}`.trim(),
                    `${base}.pdf`,
                    HEADERS,
                    exportRows(),
                    { landscape: true },
                  )
                }
              >
                Download PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {isLoading && <div className="text-muted-foreground">Loading history…</div>}
        {!isLoading && detailRows.length === 0 && (
          <div className="text-muted-foreground">No acquisition-cost changes recorded yet.</div>
        )}
        {detailRows.map((r) => {
          const component = r.summary?.component as AcqReason | undefined;
          const label = component ? ACQ_LABELS[component] ?? component : "Acquisition cost";
          const before = r.before_data;
          const after = r.after_data;
          return (
            <div key={r.id} className="rounded-md border p-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{label}</span>
                <Badge variant="outline" className="capitalize">
                  {String(r.summary?.outcome ?? (r.action === "container_acquisition_override" ? "override" : "change")).replace(/_/g, " ")}
                </Badge>
              </div>
              {(before || after) && (
                <div className="text-xs">
                  {before && (
                    <span className="line-through text-muted-foreground mr-2">
                      {fmt(before.total_amount, before.currency)}
                    </span>
                  )}
                  {after && <span className="font-medium">{fmt(after.total_amount, after.currency)}</span>}
                </div>
              )}
              {r.entity_ref && <div className="text-xs text-muted-foreground">Invoice {r.entity_ref}</div>}
              {r.summary?.reason && <div className="text-xs">Reason: {r.summary.reason}</div>}
              <div className="text-xs text-muted-foreground">
                {r.actor_email ?? "System"} · {new Date(r.created_at).toLocaleString()}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
