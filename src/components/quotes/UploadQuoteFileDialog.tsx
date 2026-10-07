import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import { parseBoqRows, type BoqItem, type BoqSection } from "@/lib/boq-import";

type ParsedItem = BoqItem;
type ParsedSection = BoqSection;

function pickSheet(wb: XLSX.WorkBook): XLSX.WorkSheet | null {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
    if (rows.some((r) => (r ?? []).some((c) => String(c ?? "").trim() !== ""))) return ws;
  }
  return null;
}

function parseSpreadsheet(file: File): Promise<{ sections: ParsedSection[]; error?: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: "array" });
        const ws = pickSheet(wb);
        if (!ws) return resolve({ sections: [], error: "The file has no data rows." });
        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
        resolve(parseBoqRows(rows));
      } catch (e) { reject(e); }
    };
    reader.readAsArrayBuffer(file);
  });
}


function downloadExcelTemplate() {
  const rows = [
    ["Section", "Description", "Unit", "Quantity", "Unit Price", "Discount %", "Tax %"],
    ["Structural", "", "", "", "", "", ""],
    ["Structural", "20ft container base", "pc", 1, 2500, 0, 16],
    ["Structural", "Structural reinforcement", "lot", 1, 800, 0, 16],
    ["Electrical", "", "", "", "", "", ""],
    ["Electrical", "LED lighting kit", "set", 2, 120, 5, 16],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [12,40,10,10,14,12,10].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "BOQ");
  XLSX.writeFile(wb, "quote-template-upload.xlsx");
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

export function UploadQuoteFileDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (templateId: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"full" | "pack">("full");
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [sections, setSections] = useState<ParsedSection[]>([]);
  const [parseNote, setParseNote] = useState<string | null>(null);

  const reset = () => { setName(""); setKind("full"); setFile(null); setSections([]); setParseNote(null); };

  const handleFile = async (f: File | null) => {
    setFile(f);
    setSections([]);
    setParseNote(null);
    if (!f) return;
    setParsing(true);
    try {
      const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        const b64 = await fileToBase64(f);
        const { data, error } = await supabase.functions.invoke("parse-quote-pdf", {
          body: { file_data: b64, filename: f.name, mime: f.type || "application/pdf" },
        });
        if (error) throw error;
        const pdfSections = ((data as any)?.sections ?? []) as ParsedSection[];
        setSections(pdfSections);
        if (!pdfSections.length) setParseNote("No priced lines could be read from this PDF.");
      } else {
        const { sections: parsed, error } = await parseSpreadsheet(f);
        setSections(parsed);
        if (error) setParseNote(error);
      }
      if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
    } catch (e: any) {
      setParseNote(e.message ?? String(e));
      toast({ title: "Parse failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };


  const updateItem = (si: number, ii: number, patch: Partial<ParsedItem>) => {
    setSections((prev) => prev.map((s, i) => i !== si ? s : {
      ...s, items: s.items.map((it, j) => j !== ii ? it : { ...it, ...patch }),
    }));
  };
  const updateSectionTitle = (si: number, title: string) => {
    setSections((prev) => prev.map((s, i) => i === si ? { ...s, title } : s));
  };

  const commit = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Template name is required");
      if (!sections.length) throw new Error("Nothing parsed yet");
      const { data: tpl, error: tErr } = await (supabase as any)
        .from("quote_templates")
        .insert({ name: name.trim(), kind, is_active: true })
        .select("id").single();
      if (tErr) throw tErr;
      const templateId = tpl.id as string;

      for (let s = 0; s < sections.length; s++) {
        const sec = sections[s];
        const { data: secRow, error: sErr } = await (supabase as any)
          .from("quote_template_sections")
          .insert({ template_id: templateId, title: sec.title || `Section ${s + 1}`, kind: "other", sort_order: s })
          .select("id").single();
        if (sErr) throw sErr;
        if (!sec.items.length) continue;
        const payload = sec.items.map((it, idx) => ({
          template_id: templateId,
          section_id: secRow.id,
          description: it.description,
          unit: it.unit,
          default_quantity: it.quantity || 1,
          default_unit_price: it.unit_price || 0,
          discount_pct: it.discount_pct || 0,
          tax_pct: it.tax_pct || 0,
          item_kind: "material",
          sort_order: idx,
        }));
        const { error: iErr } = await (supabase as any).from("quote_template_items").insert(payload);
        if (iErr) throw iErr;
      }
      return templateId;
    },
    onSuccess: (id) => {
      toast({ title: "Template created", description: `${sections.length} sections imported` });
      qc.invalidateQueries({ queryKey: ["quote-templates-admin"] });
      onCreated?.(id);
      reset();
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const totalItems = sections.reduce((s, x) => s + x.items.length, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-4 w-4" />Upload Quote File</DialogTitle>
          <DialogDescription>
            Import an Excel/CSV BOQ or a PDF quote to instantly create a reusable template. You can edit before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Template name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 20ft Office Container BOQ" />
          </div>
          <div className="space-y-2">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full quote</SelectItem>
                <SelectItem value="pack">Section pack</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="border rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Input type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} className="max-w-xs" />
              {parsing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {file && !parsing && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  {file.type === "application/pdf" ? <FileText className="h-3 w-3" /> : <FileSpreadsheet className="h-3 w-3" />}
                  {file.name}
                </span>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={downloadExcelTemplate}>
              <Download className="h-3 w-3 mr-1" />Download Excel template
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Excel/CSV: a header row with Description, Unit, Qty and Rate columns — section captions, repeated
            headers, subtotals and currency labels like “Unit Rate (KES)” are handled automatically.
            PDF quotes are parsed with AI (best-effort) — review before saving.
          </p>
          {parseNote && !parsing && (
            <p className="text-xs text-destructive">{parseNote}</p>
          )}
        </div>


        {sections.length > 0 && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Preview: {sections.length} section{sections.length === 1 ? "" : "s"} · {totalItems} item{totalItems === 1 ? "" : "s"}
            </div>
            <ScrollArea className="h-[360px] border rounded-md">
              <div className="p-3 space-y-4">
                {sections.map((sec, si) => (
                  <div key={si} className="space-y-2">
                    <Input value={sec.title} onChange={(e) => updateSectionTitle(si, e.target.value)} className="font-medium max-w-md" />
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[240px]">Description</TableHead>
                          <TableHead className="w-20">Unit</TableHead>
                          <TableHead className="w-24 text-right">Qty</TableHead>
                          <TableHead className="w-28 text-right">Unit Price</TableHead>
                          <TableHead className="w-20 text-right">Disc %</TableHead>
                          <TableHead className="w-20 text-right">Tax %</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sec.items.map((it, ii) => (
                          <TableRow key={ii}>
                            <TableCell><Input value={it.description} onChange={(e) => updateItem(si, ii, { description: e.target.value })} /></TableCell>
                            <TableCell><Input value={it.unit ?? ""} onChange={(e) => updateItem(si, ii, { unit: e.target.value || null })} /></TableCell>
                            <TableCell><Input type="number" value={it.quantity} onChange={(e) => updateItem(si, ii, { quantity: Number(e.target.value) })} className="text-right" /></TableCell>
                            <TableCell><Input type="number" value={it.unit_price} onChange={(e) => updateItem(si, ii, { unit_price: Number(e.target.value) })} className="text-right" /></TableCell>
                            <TableCell><Input type="number" value={it.discount_pct} onChange={(e) => updateItem(si, ii, { discount_pct: Number(e.target.value) })} className="text-right" /></TableCell>
                            <TableCell><Input type="number" value={it.tax_pct} onChange={(e) => updateItem(si, ii, { tax_pct: Number(e.target.value) })} className="text-right" /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => commit.mutate()} disabled={!name.trim() || !sections.length || commit.isPending || parsing}>
            {commit.isPending ? "Creating…" : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
