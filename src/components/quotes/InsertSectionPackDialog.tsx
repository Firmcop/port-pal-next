import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Package } from "lucide-react";

interface Props {
  targetTemplateId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onInserted?: () => void;
}

export function InsertSectionPackDialog({ targetTemplateId, open, onOpenChange, onInserted }: Props) {
  const { toast } = useToast();
  const [packId, setPackId] = useState<string>("");
  const [prefix, setPrefix] = useState<string>("");
  const [multiplier, setMultiplier] = useState<number>(1);

  const { data: packs = [] } = useQuery({
    queryKey: ["quote-template-packs"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("quote_templates")
        .select("id,name,description")
        .eq("kind", "pack")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []).filter((t: any) => t.id !== targetTemplateId);
    },
  });

  const insert = useMutation({
    mutationFn: async () => {
      if (!packId) throw new Error("Pick a section pack");
      const { error } = await (supabase as any).rpc("insert_section_pack_into_template", {
        _target_template_id: targetTemplateId,
        _pack_template_id: packId,
        _title_prefix: prefix.trim() || null,
        _qty_multiplier: multiplier || 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Section pack inserted" });
      onInserted?.();
      onOpenChange(false);
      setPackId(""); setPrefix(""); setMultiplier(1);
    },
    onError: (e: any) => toast({ title: "Insert failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4" /> Insert Section Pack
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Section pack</Label>
            <Select value={packId} onValueChange={setPackId}>
              <SelectTrigger><SelectValue placeholder={packs.length ? "Choose a pack" : "No active section packs"} /></SelectTrigger>
              <SelectContent>
                {packs.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Title prefix (optional)</Label>
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. Electrical pack" />
            <p className="text-xs text-muted-foreground mt-1">Prepended to each inserted section title for traceability.</p>
          </div>
          <div>
            <Label>Quantity multiplier</Label>
            <Input type="number" min={0.01} step={0.01} value={multiplier}
              onChange={(e) => setMultiplier(Number(e.target.value))} />
            <p className="text-xs text-muted-foreground mt-1">Applied to every item's default quantity.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => insert.mutate()} disabled={!packId || insert.isPending}>
            {insert.isPending ? "Inserting..." : "Insert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
