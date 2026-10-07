import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Image as ImageIcon, Sparkles, Trash2, Upload, Library, Search } from "lucide-react";

const VISUAL_KINDS = [
  { value: "cover", label: "Cover Image" },
  { value: "render", label: "3D Render" },
  { value: "floor_plan", label: "Floor Plan" },
  { value: "section_design", label: "Section Design" },
  { value: "material_sample", label: "Material Sample" },
];

interface Props {
  quoteId: string;
  sections: Array<{ id: string; title: string }>;
}

export default function QuoteVisualsTab({ quoteId, sections }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiKind, setAiKind] = useState("render");
  const [aiSection, setAiSection] = useState<string>("__none__");
  const [aiBusy, setAiBusy] = useState(false);
  const [libQuery, setLibQuery] = useState("");
  const [libKind, setLibKind] = useState<string>("__all__");

  const { data: visuals = [] } = useQuery({
    queryKey: ["quote-visuals", quoteId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("quote_visuals")
        .select("*")
        .eq("quote_id", quoteId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: library = [] } = useQuery({
    queryKey: ["quote-visual-library", libQuery, libKind],
    queryFn: async () => {
      let q = (supabase as any).from("quote_visual_library").select("*").limit(60);
      if (libKind !== "__all__") q = q.eq("kind", libKind);
      if (libQuery.trim()) q = q.ilike("tags", `%${libQuery.trim()}%`);
      const { data, error } = await q;
      if (error) return [];
      return data ?? [];
    },
    enabled: libraryOpen,
  });

  const addVisual = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await (supabase as any).from("quote_visuals").insert({
        quote_id: quoteId,
        ...payload,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote-visuals", quoteId] });
      toast({ title: "Visual added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteVisual = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("quote_visuals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quote-visuals", quoteId] }),
  });

  const handleUpload = async (file: File, kind: string, sectionId: string | null) => {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${quoteId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await (supabase as any).storage.from("quote-visuals").upload(path, file);
    if (error) { toast({ title: "Upload failed", description: error.message, variant: "destructive" }); return; }
    const { data: signed } = await (supabase as any).storage.from("quote-visuals").createSignedUrl(path, 60 * 60 * 24 * 365);
    await addVisual.mutateAsync({
      kind, section_id: sectionId,
      image_url: signed?.signedUrl ?? path,
      storage_path: path,
    });
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("generate-quote-visual", {
        body: { quote_id: quoteId, prompt: aiPrompt, kind: aiKind, section_id: aiSection === "__none__" ? null : aiSection },
      });
      if (error) throw error;
      toast({ title: "Visual generated", description: data?.caption ?? "" });
      qc.invalidateQueries({ queryKey: ["quote-visuals", quoteId] });
      setAiOpen(false);
      setAiPrompt("");
    } catch (e: any) {
      toast({ title: "AI generation failed", description: e.message, variant: "destructive" });
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setLibraryOpen(true)} variant="outline" size="sm">
          <Library className="mr-1 h-4 w-4" />Browse Library
        </Button>
        <Button onClick={() => setAiOpen(true)} variant="outline" size="sm">
          <Sparkles className="mr-1 h-4 w-4" />Generate with AI
        </Button>
        <label className="inline-flex">
          <Button asChild variant="outline" size="sm">
            <span><Upload className="mr-1 h-4 w-4" />Upload</span>
          </Button>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f, "render", null);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {visuals.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">
          <ImageIcon className="mx-auto h-10 w-10 mb-2 opacity-50" />
          No visuals yet. Browse the library, upload, or generate with AI to enrich your quote.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {visuals.map((v: any) => (
            <Card key={v.id} className="overflow-hidden">
              <div className="aspect-video bg-muted">
                <img src={v.image_url} className="w-full h-full object-cover" alt={v.caption ?? v.kind} />
              </div>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="text-xs">{v.kind.replace("_", " ")}</Badge>
                  <Button size="icon" variant="ghost" onClick={() => deleteVisual.mutate(v.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                {v.section_id && (
                  <div className="text-xs text-muted-foreground">
                    Section: {sections.find((s) => s.id === v.section_id)?.title ?? "—"}
                  </div>
                )}
                {v.caption && <div className="text-xs">{v.caption}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Library dialog */}
      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Visual Library</DialogTitle></DialogHeader>
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search tags…" value={libQuery} onChange={(e) => setLibQuery(e.target.value)} className="pl-8" />
            </div>
            <Select value={libKind} onValueChange={setLibKind}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All kinds</SelectItem>
                {VISUAL_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {library.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No library items match. Try a different search or generate with AI.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {library.map((it: any) => (
                <Card key={it.id} className="overflow-hidden cursor-pointer hover:ring-2 ring-primary"
                  onClick={() => {
                    addVisual.mutate({
                      kind: it.kind, image_url: it.image_url,
                      caption: it.title, library_id: it.id,
                    });
                    setLibraryOpen(false);
                  }}>
                  <div className="aspect-video bg-muted">
                    <img src={it.image_url} className="w-full h-full object-cover" alt={it.title} />
                  </div>
                  <CardContent className="p-2">
                    <div className="text-xs font-medium truncate">{it.title}</div>
                    <Badge variant="outline" className="text-[10px] mt-1">{it.kind.replace("_", " ")}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* AI generate dialog */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Generate Visual with AI</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Select value={aiKind} onValueChange={setAiKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VISUAL_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Attach to Section (optional)</Label>
              <Select value={aiSection} onValueChange={setAiSection}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None (cover/appendix) —</SelectItem>
                  {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Prompt</Label>
              <Textarea
                rows={4}
                placeholder="e.g. Modern 40ft container house, charcoal cladding, large picture window, dusk lighting"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiOpen(false)}>Cancel</Button>
            <Button onClick={handleAiGenerate} disabled={aiBusy || !aiPrompt.trim()}>
              {aiBusy ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
