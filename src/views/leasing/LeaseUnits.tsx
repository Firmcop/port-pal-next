import { useMemo, useState } from "react";
import { getDefaultCurrency } from "@/lib/finance-format";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileSpreadsheet, ExternalLink, Search, RotateCcw } from "lucide-react";
import { exportCSV } from "@/lib/export-utils";
import * as XLSX from "xlsx";

function daysSince(d?: string | null, end?: string | null) {
  if (!d) return 0;
  const endTs = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.floor((endTs - new Date(d).getTime()) / 86400000));
}

export default function LeaseUnits() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [agreementId, setAgreementId] = useState<string>("all");
  const [lesseeId, setLesseeId] = useState<string>("all");
  const [onFrom, setOnFrom] = useState("");
  const [onTo, setOnTo] = useState("");
  const [offFrom, setOffFrom] = useState("");
  const [offTo, setOffTo] = useState("");
  const [minDays, setMinDays] = useState("");
  const [maxDays, setMaxDays] = useState("");

  const { data: agreements } = useQuery({
    queryKey: ["lease-agreements-light"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lease_agreements")
        .select("id, lease_number, lessee_name, customer_id, currency, default_per_diem, free_days_pickup")
        .order("lease_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const lessees = useMemo(() => {
    const seen = new Map<string, string>();
    (agreements ?? []).forEach((a: any) => {
      if (a.customer_id && !seen.has(a.customer_id)) seen.set(a.customer_id, a.lessee_name);
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [agreements]);

  const { data: units, isLoading } = useQuery({
    queryKey: ["lease-units-search", { search, status, agreementId, lesseeId, onFrom, onTo, offFrom, offTo }],
    queryFn: async () => {
      let q = supabase
        .from("lease_units")
        .select("*, lease_agreements!inner(id, lease_number, lessee_name, customer_id, currency, default_per_diem, free_days_pickup), containers(container_number, size, category, status)")
        .order("on_hire_at", { ascending: false })
        .limit(500);

      if (status !== "all") q = q.eq("status", status as any);
      if (agreementId !== "all") q = q.eq("lease_id", agreementId);
      if (lesseeId !== "all") q = q.eq("lease_agreements.customer_id", lesseeId);
      if (onFrom) q = q.gte("on_hire_at", onFrom);
      if (onTo) q = q.lte("on_hire_at", `${onTo}T23:59:59`);
      if (offFrom) q = q.gte("off_hire_at", offFrom);
      if (offTo) q = q.lte("off_hire_at", `${offTo}T23:59:59`);

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const minD = minDays ? parseInt(minDays) : null;
    const maxD = maxDays ? parseInt(maxDays) : null;
    return (units ?? [])
      .map((u: any) => {
        const free = u.lease_agreements?.free_days_pickup ?? 0;
        const days = Math.max(0, daysSince(u.on_hire_at, u.off_hire_at) - free);
        const rate = parseFloat(String(u.effective_per_diem ?? "")) || parseFloat(String(u.lease_agreements?.default_per_diem ?? "")) || 0;
        return {
          id: u.id,
          container: u.containers?.container_number ?? "",
          size: u.containers?.size ?? "",
          category: u.containers?.category ?? "",
          lease_id: u.lease_id,
          lease_number: u.lease_agreements?.lease_number ?? "",
          lessee: u.lease_agreements?.lessee_name ?? "",
          status: u.status,
          on_hire_at: u.on_hire_at,
          off_hire_at: u.off_hire_at,
          days,
          rate,
          accrued: days * rate,
          dpp: !!u.dpp_active,
          currency: u.lease_agreements?.currency ?? getDefaultCurrency(),
        };
      })
      .filter((r) => {
        if (s && !(r.container.toLowerCase().includes(s) || r.lease_number.toLowerCase().includes(s) || r.lessee.toLowerCase().includes(s))) return false;
        if (minD !== null && r.days < minD) return false;
        if (maxD !== null && r.days > maxD) return false;
        return true;
      });
  }, [units, search, minDays, maxDays]);

  const totals = useMemo(() => ({
    units: rows.length,
    onHire: rows.filter((r) => r.status === "on_hire").length,
    accrued: rows.reduce((s, r) => s + r.accrued, 0),
  }), [rows]);

  const reset = () => {
    setSearch(""); setStatus("all"); setAgreementId("all"); setLesseeId("all");
    setOnFrom(""); setOnTo(""); setOffFrom(""); setOffTo(""); setMinDays(""); setMaxDays("");
  };

  const headers = ["Container", "Size", "Category", "Lease #", "Lessee", "Status", "On-Hire", "Off-Hire", "Billable Days", "Per Diem", "Currency", "Accrued", "DPP"];
  const dataRows = () => rows.map((r) => [
    r.container, r.size, r.category, r.lease_number, r.lessee, r.status,
    r.on_hire_at ? new Date(r.on_hire_at).toISOString().slice(0, 10) : "",
    r.off_hire_at ? new Date(r.off_hire_at).toISOString().slice(0, 10) : "",
    String(r.days), r.rate.toFixed(2), r.currency, r.accrued.toFixed(2), r.dpp ? "Yes" : "No",
  ]);

  const exportXlsx = () => {
    const wb = XLSX.utils.book_new();
    const sheetData = [headers, ...dataRows()];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 12) }));
    XLSX.utils.book_append_sheet(wb, ws, "Lease Units");
    XLSX.writeFile(wb, `lease-units-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportCsvFile = () =>
    exportCSV(`lease-units-${new Date().toISOString().slice(0, 10)}.csv`, headers, dataRows());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Lease Units — Search</h1>
          <p className="text-muted-foreground text-sm">
            {totals.units} matches · {totals.onHire} on-hire · accrued {totals.accrued.toFixed(2)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsvFile} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportXlsx} disabled={!rows.length}>
            <FileSpreadsheet className="h-4 w-4 mr-1" />Excel
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Container, lease #, lessee..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="on_hire">On-Hire</SelectItem>
                  <SelectItem value="off_hire">Off-Hire</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Agreement</Label>
              <Select value={agreementId} onValueChange={setAgreementId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Agreements</SelectItem>
                  {agreements?.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.lease_number} — {a.lessee_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Lessee</Label>
              <Select value={lesseeId} onValueChange={setLesseeId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Lessees</SelectItem>
                  {lessees.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">On-Hire From</Label>
              <Input type="date" value={onFrom} onChange={(e) => setOnFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">On-Hire To</Label>
              <Input type="date" value={onTo} onChange={(e) => setOnTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Off-Hire From</Label>
              <Input type="date" value={offFrom} onChange={(e) => setOffFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Off-Hire To</Label>
              <Input type="date" value={offTo} onChange={(e) => setOffTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Min Days</Label>
              <Input type="number" value={minDays} onChange={(e) => setMinDays(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max Days</Label>
              <Input type="number" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button variant="ghost" size="sm" onClick={reset} className="w-full">
                <RotateCcw className="h-4 w-4 mr-1" />Reset
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Container</TableHead>
                <TableHead>Lease #</TableHead>
                <TableHead>Lessee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>On-Hire</TableHead>
                <TableHead>Off-Hire</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Per Diem</TableHead>
                <TableHead className="text-right">Accrued</TableHead>
                <TableHead>DPP</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={11} />
              ) : !rows.length ? (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No matches.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.container || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.lease_number}</TableCell>
                  <TableCell>{r.lessee}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={r.status === "on_hire" ? "bg-success/15 text-success border-success/30" : "bg-gray-500/15 text-gray-700 border-gray-300"}>
                      {r.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{r.on_hire_at ? new Date(r.on_hire_at).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-xs">{r.off_hire_at ? new Date(r.off_hire_at).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-right">{r.days}</TableCell>
                  <TableCell className="text-right font-mono">{r.rate.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono">{r.currency} {r.accrued.toFixed(2)}</TableCell>
                  <TableCell>{r.dpp ? <Badge variant="outline" className="bg-info/15 text-info border-info/30">DPP</Badge> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="ghost">
                      <Link to={`/leasing/agreements/${r.lease_id}`}><ExternalLink className="h-4 w-4" /></Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
