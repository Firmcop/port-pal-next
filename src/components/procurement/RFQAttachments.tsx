import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Paperclip, Upload, Download, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useOrganization } from "@/hooks/use-organization";
import { uploadRfqAttachment, signRfqAttachment, deleteRfqAttachment } from "@/lib/rfq-attachments";

interface Props {
  rfqId: string;
  items: Array<{ id: string; description: string }>;
  disabled?: boolean;
}

export default function RFQAttachments({ rfqId, items, disabled }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { organizationId } = useOrganization();
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [itemScope, setItemScope] = useState<string>("rfq");

  const { data: attachments } = useQuery({
    queryKey: ["rfq-attachments", rfqId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rfq_attachments")
        .select("*, rfq_items(description)")
        .eq("rfq_id", rfqId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      if (!organizationId) throw new Error("No organization");
      const meta = await uploadRfqAttachment(organizationId, rfqId, file);
      const { error } = await supabase.from("rfq_attachments").insert({
        rfq_id: rfqId,
        rfq_item_id: itemScope === "rfq" ? null : itemScope,
        file_path: meta.path,
        file_name: meta.name,
        content_type: meta.contentType,
        size_bytes: meta.size,
        label: label || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfq-attachments", rfqId] });
      setLabel(""); setItemScope("rfq");
      if (fileRef.current) fileRef.current.value = "";
      toast({ title: "Uploaded" });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (att: any) => {
      await deleteRfqAttachment(att.file_path).catch(() => {});
      const { error } = await supabase.from("rfq_attachments").delete().eq("id", att.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfq-attachments", rfqId] });
      toast({ title: "Deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const download = async (att: any) => {
    const url = await signRfqAttachment(att.file_path);
    if (!url) { toast({ title: "Failed to fetch file", variant: "destructive" }); return; }
    window.open(url, "_blank");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Paperclip className="h-5 w-5" />Attachments & specifications</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!disabled && (
          <div className="flex flex-wrap gap-2 items-end p-3 rounded-md border border-dashed">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">Label (optional)</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Drawing rev A, Terms, etc." />
            </div>
            <div className="w-56">
              <label className="text-xs text-muted-foreground">Scope</label>
              <Select value={itemScope} onValueChange={setItemScope}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rfq">Whole RFQ</SelectItem>
                  {items.map((it) => <SelectItem key={it.id} value={it.id}>Item: {it.description.slice(0, 40)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Input ref={fileRef} type="file" className="max-w-xs"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMut.mutate(f); }} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadMut.isPending}>
              <Upload className="h-4 w-4 me-1" />{uploadMut.isPending ? "Uploading…" : "Upload"}
            </Button>
          </div>
        )}

        {(attachments ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No attachments yet.</p>
        ) : (
          <ul className="divide-y">
            {(attachments ?? []).map((a: any) => (
              <li key={a.id} className="flex items-center gap-3 py-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{a.label || a.file_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {a.file_name} · {a.size_bytes ? `${(a.size_bytes / 1024).toFixed(1)} KB` : ""} · {format(new Date(a.created_at), "PP p")}
                    {a.rfq_items?.description ? ` · Item: ${a.rfq_items.description}` : ""}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => download(a)}><Download className="h-4 w-4" /></Button>
                {!disabled && (
                  <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(a)}><Trash2 className="h-4 w-4" /></Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
