import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, AlertTriangle, CheckCircle2, FileSpreadsheet, Download, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  parseUpload,
  exportErrorReport,
  type RegistryConfig,
  type ParsedRow,
  type ParseError,
} from "@/lib/excel-io";
import { loadYardContext, preflightContainerRows } from "@/lib/yard-validation";

type RowResult = {
  row: number;
  key: string;
  status: "ok" | "gated_in" | "gated_out" | "error" | "resolved";
  message?: string;
  payload?: Record<string, any>;
  rowData?: Record<string, any>; // editable copy for retry
};

export function ImportDialog({
  open,
  onOpenChange,
  config,
  schema,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: RegistryConfig;
  schema: z.ZodTypeAny;
  onDone?: () => void;
}) {
  const { organizationId } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [valid, setValid] = useState<ParsedRow[]>([]);
  const [invalid, setInvalid] = useState<ParseError[]>([]);
  const [summary, setSummary] = useState<{ created: number; updated: number; gatedIn: number; gatedOut: number; failed: number } | null>(null);
  const [rowResults, setRowResults] = useState<RowResult[]>([]);
  const [retryingRow, setRetryingRow] = useState<number | null>(null);

  const transientKeys = useMemo(
    () => new Set(config.columns.filter((c) => c.transient).map((c) => c.key)),
    [config],
  );
  const editableCols = useMemo(() => config.columns, [config]);

  const reset = () => {
    setValid([]); setInvalid([]); setSummary(null); setRowResults([]);
  };

  const stripTransient = (obj: Record<string, any>) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) if (!transientKeys.has(k)) out[k] = v;
    return out;
  };

  const pickPayload = (row: Record<string, any>) => {
    const payload: Record<string, any> = {};
    for (const k of transientKeys) if (row[k] !== undefined && row[k] !== null && row[k] !== "") payload[k] = row[k];
    return payload;
  };

  const dispatchRpc = (row: Record<string, any>) => {
    if (row.is_gate_out || row.gate_out_at || row.exit_eir_number || row.gross_weight_kg) return "gate_out_imported_container";
    return config.postImportRpc!;
  };

  const audit = async (
    key: string,
    rowNumber: number,
    outcome: "success" | "error" | "gated_in" | "gated_out",
    message: string | undefined,
    payload: Record<string, any>,
  ) => {
    if (!organizationId) return;
    try {
      await supabase.from("import_audit_rows").insert({
        organization_id: organizationId,
        table_name: config.table,
        business_key: key,
        row_number: rowNumber,
        outcome,
        message: message ?? null,
        payload: payload as any,
      });
    } catch (e) {
      console.warn("audit insert failed", e);
    }
  };

  const onFile = async (file: File) => {
    reset();
    setParsing(true);
    try {
      const result = await parseUpload(file, config, schema);
      // Preflight yard validation for the containers registry
      if (config.table === "containers" && organizationId && result.valid.length) {
        const ctx = await loadYardContext(organizationId);
        const issues = preflightContainerRows(result.valid, ctx);
        if (issues.size) {
          const movedToInvalid: ParseError[] = [];
          const stillValid: ParsedRow[] = [];
          for (const r of result.valid) {
            const errs = issues.get(r.rowNumber);
            if (errs) movedToInvalid.push({ rowNumber: r.rowNumber, raw: r.raw, errors: errs });
            else stillValid.push(r);
          }
          result.valid = stillValid;
          result.invalid = [...result.invalid, ...movedToInvalid];
        }
      }
      setValid(result.valid);
      setInvalid(result.invalid);
      if (result.valid.length === 0 && result.invalid.length === 0) {
        toast({ title: "No rows found in file", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Parse error", description: e.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const persistOneRow = async (
    rowData: Record<string, any>,
    rowNumber: number,
    existingKeySet?: Set<string>,
  ): Promise<RowResult> => {
    const key = String(rowData[config.businessKey] ?? "");
    const persistRow = { ...stripTransient(rowData), organization_id: organizationId };
    const isUpdate = existingKeySet ? existingKeySet.has(key) : false;

    const { error } = await supabase
      .from(config.table as any)
      .upsert(persistRow as any, { onConflict: config.uniqueOn });
    if (error) {
      const msg = [error.message, (error as any).details, (error as any).hint].filter(Boolean).join(" — ") || "upsert failed";
      const result: RowResult = { row: rowNumber, key, status: "error", message: msg, rowData };
      await audit(key, rowNumber, "error", msg, rowData);
      return result;
    }

    if (config.postImportRpc && (config.postImportTrigger ?? (() => true))(rowData)) {
      const rpc = dispatchRpc(rowData);
      const payload = pickPayload(rowData);
      const { data: rpcOk, error: rpcErr } = await supabase.rpc(rpc as any, {
        _container_number: key, _payload: payload,
      } as any);
      if (rpcErr) {
        const msg = [rpcErr.message, (rpcErr as any).details, (rpcErr as any).hint].filter(Boolean).join(" — ");
        const label = rpc === "gate_out_imported_container" ? "Gate-out" : "Gate-in";
        const result: RowResult = { row: rowNumber, key, status: "error", message: `${label} failed: ${msg}`, rowData };
        await audit(key, rowNumber, "error", result.message, rowData);
        return result;
      }
      const isOut = rpc === "gate_out_imported_container";
      const eir = (rpcOk as any)?.eir_number;
      const result: RowResult = {
        row: rowNumber, key,
        status: isOut ? "gated_out" : "gated_in",
        message: eir ? `EIR ${eir}` : isOut ? "gated out" : "gated in",
        rowData,
      };
      await audit(key, rowNumber, isOut ? "gated_out" : "gated_in", result.message, rowData);
      return result;
    }
    const result: RowResult = { row: rowNumber, key, status: isUpdate ? "ok" : "ok", message: isUpdate ? "updated" : "created", rowData };
    await audit(key, rowNumber, "success", result.message, rowData);
    return result;
  };

  const apply = async () => {
    if (!valid.length) return;
    if (!organizationId) {
      toast({ title: "No organization", description: "You're not assigned to an organization — imports cannot be saved. Contact your admin.", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const keys = valid.map((r) => r.data[config.businessKey]);
      const { data: existingRows } = await supabase
        .from(config.table as any).select(config.businessKey).in(config.businessKey, keys as any);
      const existing = new Set((existingRows ?? []).map((r: any) => String(r[config.businessKey])));

      const results: RowResult[] = [];
      let created = 0, updated = 0, gatedIn = 0, gatedOut = 0, failed = 0;

      // Failed parse rows seeded as editable, retryable rows
      for (const inv of invalid) {
        results.push({
          row: inv.rowNumber,
          key: String(inv.raw[config.columns.find((c) => c.key === config.businessKey)?.label ?? ""] ?? ""),
          status: "error",
          message: inv.errors.join("; "),
          rowData: { ...inv.raw } as any,
        });
        failed++;
      }

      for (const r of valid) {
        const res = await persistOneRow(r.data, r.rowNumber, existing);
        results.push(res);
        if (res.status === "error") failed++;
        else if (res.status === "gated_in") gatedIn++;
        else if (res.status === "gated_out") gatedOut++;
        else if (existing.has(res.key)) updated++;
        else created++;
      }

      setSummary({ created, updated, gatedIn, gatedOut, failed });
      setRowResults(results.sort((a, b) => a.row - b.row));
      qc.invalidateQueries();
      onDone?.();
      toast({
        title: "Import complete",
        description: `Created ${created} · Updated ${updated}${gatedIn ? ` · Gated-in ${gatedIn}` : ""}${gatedOut ? ` · Gated-out ${gatedOut}` : ""}${failed ? ` · Failed ${failed}` : ""}`,
      });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const retryRow = async (rowNumber: number) => {
    const target = rowResults.find((r) => r.row === rowNumber);
    if (!target?.rowData) return;
    setRetryingRow(rowNumber);
    try {
      // Re-validate via schema
      const parsed = schema.safeParse(target.rowData);
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`).join("; ");
        setRowResults((prev) => prev.map((r) => r.row === rowNumber ? { ...r, status: "error", message: msg } : r));
        return;
      }
      // Preflight (containers only)
      if (config.table === "containers" && organizationId) {
        const ctx = await loadYardContext(organizationId);
        const single: ParsedRow = { rowNumber, data: parsed.data, raw: target.rowData };
        const issues = preflightContainerRows([single], ctx);
        const errs = issues.get(rowNumber);
        if (errs?.length) {
          setRowResults((prev) => prev.map((r) => r.row === rowNumber ? { ...r, status: "error", message: errs.join("; ") } : r));
          return;
        }
      }
      const res = await persistOneRow(parsed.data, rowNumber);
      const newStatus = res.status === "error" ? "error" : "resolved";
      setRowResults((prev) => prev.map((r) => r.row === rowNumber ? { ...res, status: newStatus, rowData: parsed.data } : r));
      qc.invalidateQueries();
      if (res.status !== "error") {
        setSummary((s) => s ? { ...s, failed: Math.max(0, s.failed - 1) } : s);
      }
    } finally {
      setRetryingRow(null);
    }
  };

  const updateRowField = (rowNumber: number, key: string, value: any) => {
    setRowResults((prev) => prev.map((r) => r.row === rowNumber
      ? { ...r, rowData: { ...(r.rowData ?? {}), [key]: value } }
      : r));
  };

  const renderEditCell = (col: typeof editableCols[number], row: RowResult) => {
    const v = row.rowData?.[col.key] ?? row.rowData?.[col.label];
    if (col.type === "boolean") {
      return (
        <select
          className="text-xs border rounded px-1 py-0.5 bg-background w-20"
          value={v === true ? "true" : v === false ? "false" : ""}
          onChange={(e) => updateRowField(row.row, col.key, e.target.value === "" ? null : e.target.value === "true")}
        >
          <option value="">—</option><option value="true">true</option><option value="false">false</option>
        </select>
      );
    }
    if (col.enum?.length) {
      return (
        <select
          className="text-xs border rounded px-1 py-0.5 bg-background"
          value={String(v ?? "")}
          onChange={(e) => updateRowField(row.row, col.key, e.target.value || null)}
        >
          <option value="">—</option>
          {col.enum.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return (
      <Input
        className="h-6 text-xs"
        value={v ?? ""}
        onChange={(e) => {
          let val: any = e.target.value;
          if (col.type === "number") val = val === "" ? null : Number(val);
          updateRowField(row.row, col.key, val);
        }}
      />
    );
  };

  const failedResults = rowResults.filter((r) => r.status === "error");

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Import {config.label}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[65vh] overflow-y-auto">
          {!valid.length && !invalid.length && !summary && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Upload an .xlsx file. Existing rows are matched by{" "}
                <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{config.businessKey}</span>{" "}
                — matching rows are updated, new keys are inserted.
              </p>
              <Input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} disabled={parsing} />
              {parsing && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
          )}

          {(valid.length > 0 || invalid.length > 0) && !summary && (
            <>
              <div className="flex flex-wrap gap-3 items-center">
                <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                  <CheckCircle2 className="h-3.5 w-3.5 me-1" /> {valid.length} valid
                </Badge>
                {invalid.length > 0 && (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                    <AlertTriangle className="h-3.5 w-3.5 me-1" /> {invalid.length} with errors
                  </Badge>
                )}
                {invalid.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => exportErrorReport(invalid, `${config.table}-errors.xlsx`)}>
                    <Download className="h-4 w-4 me-1" /> Download errors
                  </Button>
                )}
              </div>

              {invalid.length > 0 && (
                <div className="border rounded-md max-h-48 overflow-y-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead className="w-16">Row</TableHead><TableHead>Error</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {invalid.slice(0, 50).map((e) => (
                        <TableRow key={e.rowNumber}>
                          <TableCell className="font-mono">{e.rowNumber}</TableCell>
                          <TableCell className="text-xs text-destructive">{e.errors.join("; ")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}

          {summary && (
            <div className="space-y-3 py-2">
              <div className="text-center space-y-1">
                <CheckCircle2 className="h-10 w-10 text-success mx-auto" />
                <p className="font-medium">Import complete</p>
                <p className="text-sm text-muted-foreground">
                  Created <strong>{summary.created}</strong> · Updated <strong>{summary.updated}</strong>
                  {summary.gatedIn > 0 && <> · Gated-in <strong className="text-success">{summary.gatedIn}</strong></>}
                  {summary.gatedOut > 0 && <> · Gated-out <strong className="text-success">{summary.gatedOut}</strong></>}
                  {summary.failed > 0 && <> · Failed <strong className="text-destructive">{summary.failed}</strong></>}
                </p>
              </div>
              {failedResults.length > 0 && (
                <div className="border rounded-md max-h-[40vh] overflow-auto">
                  <p className="text-xs px-3 py-2 bg-muted font-medium">
                    Edit values inline and click Retry to re-run a single row. The same upsert + post-import RPC is used.
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Row</TableHead>
                        <TableHead className="w-40">Key</TableHead>
                        <TableHead>Detail</TableHead>
                        <TableHead className="w-28">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {failedResults.map((r) => (
                        <Fragment key={r.row}>
                          <TableRow>
                            <TableCell className="font-mono text-xs">{r.row}</TableCell>
                            <TableCell className="text-xs font-mono">{r.key || "—"}</TableCell>
                            <TableCell className="text-xs text-destructive">{r.message}</TableCell>
                            <TableCell>
                              <Button size="sm" variant="outline" disabled={retryingRow === r.row} onClick={() => retryRow(r.row)}>
                                {retryingRow === r.row
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <><RefreshCw className="h-3 w-3 me-1" /> Retry</>}
                              </Button>
                            </TableCell>
                          </TableRow>
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={4} className="p-2">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {editableCols.map((col) => (
                                  <label key={col.key} className="flex flex-col gap-0.5">
                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{col.label}</span>
                                    {renderEditCell(col, r)}
                                  </label>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {rowResults.some((r) => r.status === "resolved") && (
                <p className="text-xs text-success">
                  ✓ {rowResults.filter((r) => r.status === "resolved").length} row(s) resolved via retry.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {!summary ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={importing}>Cancel</Button>
              {valid.length > 0 && (
                <Button onClick={apply} disabled={importing}>
                  {importing && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
                  Apply {valid.length} change{valid.length === 1 ? "" : "s"}
                </Button>
              )}
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
