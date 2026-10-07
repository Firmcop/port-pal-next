import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { RegistryConfig } from "@/lib/excel-io";

export function BulkEditDialog({
  open,
  onOpenChange,
  config,
  selectedIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: RegistryConfig;
  selectedIds: string[];
  onDone?: () => void;
}) {
  const [field, setField] = useState<string>(config.editableFields?.[0]?.key ?? "");
  const [value, setValue] = useState<any>("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const fieldDef = config.editableFields?.find((f) => f.key === field);

  const apply = async () => {
    if (!fieldDef || !selectedIds.length) return;
    setBusy(true);
    try {
      const payload: Record<string, any> = { [field]: value };
      const { error } = await supabase
        .from(config.table as any)
        .update(payload)
        .in("id", selectedIds);
      if (error) throw error;
      toast({ title: `${selectedIds.length} ${config.label.toLowerCase()} updated` });
      qc.invalidateQueries();
      onDone?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk edit {selectedIds.length} {config.label.toLowerCase()}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Field</Label>
            <Select value={field} onValueChange={(v) => { setField(v); setValue(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {config.editableFields?.map((f) => (
                  <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>New value</Label>
            {fieldDef?.type === "boolean" ? (
              <div className="flex items-center gap-2">
                <Switch checked={!!value} onCheckedChange={setValue} />
                <span className="text-sm">{value ? "True / Active" : "False / Inactive"}</span>
              </div>
            ) : fieldDef?.enum ? (
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {fieldDef.enum.map((opt) => (
                    <SelectItem key={opt} value={opt} className="capitalize">
                      {opt.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={value ?? ""} onChange={(e) => setValue(e.target.value)} />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} disabled={busy || !field}>Apply to {selectedIds.length}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
