import { Fragment, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Layers,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { format } from "date-fns";
import { formatMoneyCode } from "@/lib/money";

type AcqInvoice = {
  invoice_id: string;
  invoice_number: string;
  reason: string;
  reference: string | null;
  supplier_name: string | null;
  total_amount: number;
  currency: string;
  status: string;
  paid_amount: number | null;
  created_at: string;
  issue: "ok" | "repeat_invoice" | "already_purchased";
  keeps_invoice: string | null;
  origin: "sale" | "eir" | "conversion" | "inventory_intake" | "unknown";
  origin_label: string;
  origin_path: string;
};

type SaleInvoice = {
  invoice_id: string;
  invoice_number: string;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
  duplicate: boolean;
};

type Row = {
  container_id: string;
  container_number: string;
  container_status: string;
  acquisition_count: number;
  duplicate_acquisition_count: number;
  sale_invoice_count: number;
  duplicate_sale_count: number;
  severity: "critical" | "warning" | "ok";
  acquisition_invoices: AcqInvoice[];
  sale_invoices: SaleInvoice[];
};

const ORIGIN_META: Record<string, { label: string; className: string }> = {
  sale: { label: "Container sale", className: "bg-primary/10 text-primary" },
  eir: { label: "Gate EIR", className: "bg-accent text-accent-foreground" },
  conversion: { label: "Conversion job", className: "bg-secondary text-secondary-foreground" },
  inventory_intake: { label: "Inventory intake", className: "bg-muted text-muted-foreground" },
  unknown: { label: "Unknown path", className: "bg-destructive/10 text-destructive" },
};

const ISSUE_META: Record<string, { label: string; className: string; hint: string }> = {
  repeat_invoice: {
    label: "Repeat invoice",
    className: "bg-destructive/15 text-destructive",
    hint: "Same container, same purpose and reference invoiced more than once.",
  },
  already_purchased: {
    label: "Already purchased",
    className: "bg-warning/15 text-warning",
    hint: "Container already carries a purchase acquisition invoice; this liability is redundant.",
  },
};

export default function InvoiceReconciliation() {
  const [search, setSearch] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["container-invoice-reconciliation"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("container_invoice_reconciliation" as any);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = useMemo(() => {
    let r = data ?? [];
    if (onlyIssues) r = r.filter((x) => x.severity !== "ok");
    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter(
        (x) =>
          x.container_number.toLowerCase().includes(q) ||
          (x.acquisition_invoices ?? []).some(
            (i) =>
              i.invoice_number.toLowerCase().includes(q) ||
              (i.origin_label ?? "").toLowerCase().includes(q),
          ),
      );
    }
    return r;
  }, [data, onlyIssues, search]);

  const stats = useMemo(() => {
    const all = data ?? [];
    const pathCounts: Record<string, number> = {};
    let dupAcq = 0;
    let dupSale = 0;
    for (const r of all) {
      dupAcq += r.duplicate_acquisition_count;
      dupSale += r.duplicate_sale_count;
      for (const i of r.acquisition_invoices ?? []) {
        if (i.issue !== "ok") pathCounts[i.origin] = (pathCounts[i.origin] ?? 0) + 1;
      }
    }
    return {
      flagged: all.filter((r) => r.severity !== "ok").length,
      dupAcq,
      dupSale,
      pathCounts,
    };
  }, [data]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoice reconciliation</h1>
          <p className="text-sm text-muted-foreground">
            Containers whose acquisition or sale invoicing looks duplicated, with the exact path that
            raised each invoice — container sale, gate EIR, conversion job or inventory intake.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" asChild>
            <Link to="/finance/acquisition-duplicates">
              <ShieldCheck className="mr-1 h-4 w-4" /> Reverse duplicates
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Containers flagged</CardDescription>
            <CardTitle className="text-2xl">{stats.flagged}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Duplicate acquisition invoices</CardDescription>
            <CardTitle className="text-2xl text-destructive">{stats.dupAcq}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Duplicate sale invoices</CardDescription>
            <CardTitle className="text-2xl text-warning">{stats.dupSale}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Duplicates by call path</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1 pb-4">
            {Object.keys(stats.pathCounts).length === 0 ? (
              <span className="text-sm text-muted-foreground">None</span>
            ) : (
              Object.entries(stats.pathCounts).map(([k, v]) => (
                <Badge key={k} variant="outline" className={ORIGIN_META[k]?.className}>
                  {ORIGIN_META[k]?.label ?? k}: {v}
                </Badge>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanSearch className="h-4 w-4" /> Findings
            <Badge variant="outline">{rows.length}</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Container, invoice or path…"
              className="h-9 w-56"
            />
            <Button variant={onlyIssues ? "default" : "outline"} size="sm" onClick={() => setOnlyIssues((v) => !v)}>
              <AlertTriangle className="mr-1 h-4 w-4" /> Issues only
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nothing to reconcile — no container shows duplicate acquisition or sale invoicing.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Container</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Acquisition</TableHead>
                    <TableHead className="text-center">Sale invoices</TableHead>
                    <TableHead>Call paths</TableHead>
                    <TableHead>Flag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const isOpen = !!open[r.container_id];
                    const paths = Array.from(
                      new Set((r.acquisition_invoices ?? []).map((i) => i.origin)),
                    );
                    return (
                      <Fragment key={r.container_id}>
                        <TableRow
                          key={r.container_id}
                          className="cursor-pointer"
                          onClick={() => setOpen((s) => ({ ...s, [r.container_id]: !isOpen }))}
                        >
                          <TableCell>
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.container_number}</TableCell>
                          <TableCell className="text-xs capitalize text-muted-foreground">
                            {(r.container_status ?? "").replace(/_/g, " ")}
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {r.acquisition_count}
                            {r.duplicate_acquisition_count > 0 && (
                              <span className="ml-1 text-destructive">
                                ({r.duplicate_acquisition_count} dup)
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {r.sale_invoice_count}
                            {r.duplicate_sale_count > 0 && (
                              <span className="ml-1 text-warning">({r.duplicate_sale_count} dup)</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {paths.map((p) => (
                                <Badge key={p} variant="outline" className={ORIGIN_META[p]?.className}>
                                  {ORIGIN_META[p]?.label ?? p}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            {r.severity === "critical" ? (
                              <Badge variant="outline" className="bg-destructive/15 text-destructive">
                                Duplicate acquisition
                              </Badge>
                            ) : r.severity === "warning" ? (
                              <Badge variant="outline" className="bg-warning/15 text-warning">
                                Duplicate sale invoice
                              </Badge>
                            ) : (
                              <Badge variant="outline">Multiple invoices</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow key={`${r.container_id}-detail`}>
                            <TableCell colSpan={7} className="bg-muted/30">
                              <div className="space-y-4 p-2">
                                <div>
                                  <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    <Layers className="h-3.5 w-3.5" /> Acquisition invoices &amp; call path
                                  </div>
                                  <div className="space-y-2">
                                    {(r.acquisition_invoices ?? []).map((i) => {
                                      const issue = ISSUE_META[i.issue];
                                      return (
                                        <div
                                          key={i.invoice_id}
                                          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-background p-2 text-sm"
                                        >
                                          <Link
                                            to={`/finance/supplier-invoices?invoice=${i.invoice_id}`}
                                            className="font-mono text-xs text-primary hover:underline"
                                          >
                                            {i.invoice_number}
                                          </Link>
                                          <span className="text-xs capitalize text-muted-foreground">
                                            {i.reason.replace(/_/g, " ")}
                                          </span>
                                          <Badge variant="outline" className={ORIGIN_META[i.origin]?.className}>
                                            {ORIGIN_META[i.origin]?.label ?? i.origin}
                                          </Badge>
                                          <Link
                                            to={i.origin_path}
                                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                          >
                                            {i.origin_label} <ExternalLink className="h-3 w-3" />
                                          </Link>
                                          <span className="text-xs text-muted-foreground">
                                            {i.supplier_name ?? "—"}
                                          </span>
                                          <span className="ml-auto font-mono text-xs">
                                            {formatMoneyCode(Number(i.total_amount), i.currency)}
                                          </span>
                                          {issue && (
                                            <Badge variant="outline" className={issue.className} title={issue.hint}>
                                              {issue.label}
                                              {i.keeps_invoice ? ` · keeps ${i.keeps_invoice}` : ""}
                                            </Badge>
                                          )}
                                          <span className="text-[11px] text-muted-foreground">
                                            {i.created_at ? format(new Date(i.created_at), "PP") : "—"}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>

                                <div>
                                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    Customer sale invoices
                                  </div>
                                  {(r.sale_invoices ?? []).length === 0 ? (
                                    <p className="text-xs text-muted-foreground">None linked.</p>
                                  ) : (
                                    <div className="space-y-2">
                                      {(r.sale_invoices ?? []).map((i) => (
                                        <div
                                          key={i.invoice_id}
                                          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-background p-2 text-sm"
                                        >
                                          <Link
                                            to={`/billing/invoices?invoice=${i.invoice_id}`}
                                            className="font-mono text-xs text-primary hover:underline"
                                          >
                                            {i.invoice_number}
                                          </Link>
                                          <span className="text-xs capitalize text-muted-foreground">{i.status}</span>
                                          <span className="ml-auto font-mono text-xs">
                                            {formatMoneyCode(Number(i.total_amount), i.currency)}
                                          </span>
                                          {i.duplicate && (
                                            <Badge variant="outline" className="bg-warning/15 text-warning">
                                              Possible duplicate
                                            </Badge>
                                          )}
                                          <span className="text-[11px] text-muted-foreground">
                                            {i.created_at ? format(new Date(i.created_at), "PP") : "—"}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
