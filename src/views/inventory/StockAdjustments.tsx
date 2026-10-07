import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Download, Search, FileText, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { BulkStockAdjustmentDialog } from "@/components/inventory/BulkStockAdjustmentDialog";

const TYPE_LABEL: Record<string, string> = {
  material: "Material",
  finished_product: "Finished product",
  sub_assembly: "Sub-assembly",
};

const ADJ_COLOR: Record<string, string> = {
  count_variance: "bg-info/15 text-info",
  write_off: "bg-destructive/15 text-destructive",
  write_on: "bg-success/15 text-success",
  reclassification: "bg-muted text-muted-foreground",
};

export default function StockAdjustments() {
  const [q, setQ] = useState("");
  const [itemType, setItemType] = useState<string>("all");
  const [adjType, setAdjType] = useState<string>("all");
  const [bulkOpen, setBulkOpen] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ["stock-adjustments", itemType, adjType],
    queryFn: async () => {
      let query = supabase
        .from("stock_adjustments" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (itemType !== "all") query = query.eq("item_type", itemType);
      if (adjType !== "all") query = query.eq("adjustment_type", adjType);
      const { data, error } = await query;
      if (error) throw error;
      return data as any[];
    },
  });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data;
    return data.filter(
      (r: any) =>
        r.reference?.toLowerCase().includes(s) ||
        r.item_label?.toLowerCase().includes(s) ||
        r.reason_text?.toLowerCase().includes(s),
    );
  }, [data, q]);

  const exportXlsx = () => {
    const sheet = XLSX.utils.json_to_sheet(
      rows.map((r: any) => ({
        Reference: r.reference,
        Date: format(new Date(r.created_at), "yyyy-MM-dd HH:mm"),
        "Item type": TYPE_LABEL[r.item_type] ?? r.item_type,
        Item: r.item_label,
        Type: r.adjustment_type,
        Reason: r.reason_category,
        "Qty before": r.qty_before,
        "Qty after": r.qty_after,
        "Qty delta": r.qty_delta,
        "Unit cost": r.unit_cost,
        "Value delta": r.value_delta,
        Currency: r.currency,
        Notes: r.reason_text,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Adjustments");
    XLSX.writeFile(wb, `stock-adjustments-${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Stock Adjustments</h1>
          <p className="text-muted-foreground text-sm">
            Immutable audit trail of every stock quantity change. Each entry posts a matching ledger journal.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <Upload className="h-4 w-4 me-1" /> Bulk upload
          </Button>
          <Button variant="outline" onClick={exportXlsx} disabled={!rows.length}>
            <Download className="h-4 w-4 me-1" /> Export
          </Button>
        </div>
      </div>

      <BulkStockAdjustmentDialog open={bulkOpen} onOpenChange={setBulkOpen} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reference, item or reason..." className="pl-9" />
            </div>
            <Select value={itemType} onValueChange={setItemType}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All item types</SelectItem>
                <SelectItem value="material">Materials</SelectItem>
                <SelectItem value="finished_product">Finished products</SelectItem>
                <SelectItem value="sub_assembly">Sub-assemblies</SelectItem>
              </SelectContent>
            </Select>
            <Select value={adjType} onValueChange={setAdjType}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All adjustment types</SelectItem>
                <SelectItem value="count_variance">Count variance</SelectItem>
                <SelectItem value="write_off">Write-off</SelectItem>
                <SelectItem value="write_on">Write-on</SelectItem>
                <SelectItem value="reclassification">Reclassification</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Qty Δ</TableHead>
                <TableHead className="text-right">Value Δ</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Journal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !rows.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No adjustments yet</TableCell></TableRow>
              ) : rows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(r.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{r.item_label}</div>
                    <div className="text-xs text-muted-foreground">{TYPE_LABEL[r.item_type] ?? r.item_type}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`capitalize ${ADJ_COLOR[r.adjustment_type] ?? ""}`}>
                      {r.adjustment_type.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize text-sm">{r.reason_category}</TableCell>
                  <TableCell className={`text-right font-mono ${Number(r.qty_delta) > 0 ? "text-success" : Number(r.qty_delta) < 0 ? "text-destructive" : ""}`}>
                    {Number(r.qty_delta) > 0 ? "+" : ""}{Number(r.qty_delta).toLocaleString()}
                  </TableCell>
                  <TableCell className={`text-right font-mono ${Number(r.value_delta) > 0 ? "text-success" : Number(r.value_delta) < 0 ? "text-destructive" : ""}`}>
                    {r.currency} {Math.abs(Number(r.value_delta)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate" title={r.reason_text}>{r.reason_text}</TableCell>
                  <TableCell>
                    {r.gl_journal_id ? (
                      <Link to={`/finance/ledger?journal=${r.gl_journal_id}`}>
                        <Button variant="ghost" size="sm"><FileText className="h-3 w-3 me-1" />JV</Button>
                      </Link>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
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
