import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { BookOpen, Layers, Search } from "lucide-react";

type Template = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  kind: "full" | "pack";
  sections?: { id: string; title: string; items: { id: string }[] }[];
};

export function TemplatePicker({
  open, onOpenChange, kind, onPick, title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: "full" | "pack";
  onPick: (templateId: string, mode: "replace" | "append") => Promise<void> | void;
  title?: string;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("append");
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["quote-templates", kind],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("quote_templates")
        .select("id, name, description, category, kind, quote_template_sections(id, title, quote_template_items(id))")
        .eq("kind", kind)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((t: any) => ({
        ...t,
        sections: (t.quote_template_sections ?? []).map((s: any) => ({
          id: s.id, title: s.title, items: s.quote_template_items ?? [],
        })),
      })) as Template[];
    },
    enabled: open,
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return data ?? [];
    return (data ?? []).filter((t) =>
      [t.name, t.description, t.category].filter(Boolean).some((v) => v!.toLowerCase().includes(term)),
    );
  }, [data, q]);

  const handleApply = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await onPick(selected, mode);
      onOpenChange(false);
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {kind === "full" ? <BookOpen className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
            {title ?? (kind === "full" ? "Start from a template" : "Add from a section pack")}
          </DialogTitle>
          <DialogDescription>
            {kind === "full"
              ? "Pick a prebuilt quotation template. You can edit items, prices and quantities afterwards."
              : "Pick a reusable bundle (e.g. Standard Electrical) to append to this section."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <ScrollArea className="h-[360px] pr-2">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : !filtered.length ? (
            <p className="p-6 text-sm text-muted-foreground">No templates yet. You can save any quote as a template from the quote detail page.</p>
          ) : (
            <RadioGroup value={selected ?? ""} onValueChange={setSelected} className="space-y-2">
              {filtered.map((t) => {
                const itemCount = (t.sections ?? []).reduce((s, sec) => s + sec.items.length, 0);
                return (
                  <Label key={t.id} htmlFor={t.id} className="block cursor-pointer">
                    <Card className={selected === t.id ? "border-primary ring-1 ring-primary" : ""}>
                      <CardContent className="flex gap-3 p-3">
                        <RadioGroupItem id={t.id} value={t.id} className="mt-1" />
                        <div className="flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">{t.name}</div>
                            <div className="flex items-center gap-1">
                              {t.category && <Badge variant="outline" className="text-xs">{t.category}</Badge>}
                              <Badge variant="secondary" className="text-xs">
                                {(t.sections ?? []).length} sections · {itemCount} items
                              </Badge>
                            </div>
                          </div>
                          {t.description && (
                            <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                          )}
                          {kind === "full" && t.sections && t.sections.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {t.sections.slice(0, 6).map((s) => (
                                <span key={s.id} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                  {s.title}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Label>
                );
              })}
            </RadioGroup>
          )}
        </ScrollArea>

        {kind === "full" && (
          <div className="border-t pt-3">
            <Label className="text-xs text-muted-foreground">Apply mode</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} className="flex gap-4 mt-1">
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <RadioGroupItem value="append" /> Append to existing sections
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer text-sm">
                <RadioGroupItem value="replace" /> Replace all existing sections
              </Label>
            </RadioGroup>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleApply} disabled={!selected || busy}>
            {busy ? "Applying…" : kind === "full" ? "Apply Template" : "Add Pack"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
