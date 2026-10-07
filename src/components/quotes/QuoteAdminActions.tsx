import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { MoreHorizontal, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";

type Quote = { id: string; quote_number: string; archived_at?: string | null };

export function QuoteAdminActions({
  quote,
  onDeleted,
  invalidateKeys = [["quotes"]],
}: {
  quote: Quote;
  onDeleted?: () => void;
  invalidateKeys?: unknown[][];
}) {
  const { isOwnerOrAdmin } = useUserStaffRole();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmNumber, setConfirmNumber] = useState("");

  const refresh = () => invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: k as any }));

  const archiveMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("archive_quote", { _quote_id: quote.id, _reason: reason || null });
      if (error) throw error;
    },
    onSuccess: () => { refresh(); toast({ title: "Quote archived" }); setArchiveOpen(false); setReason(""); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const restoreMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("unarchive_quote", { _quote_id: quote.id });
      if (error) throw error;
    },
    onSuccess: () => { refresh(); toast({ title: "Quote restored" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("delete_quote", { _quote_id: quote.id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast({ title: "Quote deleted" });
      setDeleteOpen(false); setReason(""); setConfirmNumber("");
      onDeleted?.();
    },
    onError: (e: any) => toast({ title: "Cannot delete quote", description: e.message, variant: "destructive" }),
  });

  if (!isOwnerOrAdmin) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {quote.archived_at ? (
            <DropdownMenuItem onSelect={() => restoreMut.mutate()}>
              <ArchiveRestore className="mr-2 h-4 w-4" />Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
              <Archive className="mr-2 h-4 w-4" />Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />Delete permanently
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive {quote.quote_number}</DialogTitle>
            <DialogDescription>
              The quote is hidden from the active list and locked from edits until restored.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason (optional)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button onClick={() => archiveMut.mutate()} disabled={archiveMut.isPending}>Archive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) { setReason(""); setConfirmNumber(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {quote.quote_number} permanently</DialogTitle>
            <DialogDescription>
              This removes the quote and its items. Quotes linked to a sales order, conversion job or container sale
              cannot be deleted — archive them instead. A record of this deletion is kept.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Type <span className="font-mono">{quote.quote_number}</span> to confirm</Label>
              <Input value={confirmNumber} onChange={(e) => setConfirmNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending || confirmNumber.trim() !== quote.quote_number || !reason.trim()}
              onClick={() => deleteMut.mutate()}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
