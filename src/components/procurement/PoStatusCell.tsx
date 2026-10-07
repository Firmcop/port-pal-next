import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { MoreHorizontal, Send, CheckCircle2, BadgeDollarSign, Ban, History, RotateCcw } from "lucide-react";
import { format } from "date-fns";

import PayPoDialog from "@/components/procurement/PayPoDialog";



const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  confirmed: "Confirmed",
  partially_received: "Partially received",
  received: "Received",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-info/15 text-info dark:bg-info/30 dark:text-info",
  confirmed: "bg-warning/15 text-warning dark:bg-warning/30 dark:text-warning",
  partially_received: "bg-warning/15 text-warning dark:bg-warning/30 dark:text-warning",
  received: "bg-success/15 text-success dark:bg-success/30 dark:text-success",
  paid: "bg-success/15 text-success dark:bg-success/30 dark:text-success",
  cancelled: "bg-destructive/15 text-destructive dark:bg-destructive/30 dark:text-destructive",
};

const ALL_STATUSES = ["draft", "sent", "confirmed", "partially_received", "received", "paid", "cancelled"];

/** Only forward, lifecycle-legal steps that a user can trigger manually. */
function nextAction(status: string): { to: string; label: string; icon: typeof Send } | null {
  switch (status) {
    case "draft": return { to: "sent", label: "Send to supplier", icon: Send };
    case "sent": return { to: "confirmed", label: "Mark confirmed", icon: CheckCircle2 };
    default: return null; // confirmed / partially_received advance via goods receipt; received is paid via the payment dialog
  }
}


const CANCELLABLE = ["draft", "sent", "confirmed"];

export default function PoStatusCell({ poId, status }: { poId: string; status: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const org = useOrganization();
  const isAdmin = org.role === "org_owner" || org.role === "admin";

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [resetTo, setResetTo] = useState("draft");
  const [reason, setReason] = useState("");


  const advance = useMutation({
    mutationFn: async (to: string) => {
      const { error } = await supabase.from("purchase_orders").update({ status: to } as any).eq("id", poId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["po-status-events", poId] });
      toast({ title: "Status updated" });
      setConfirmCancel(false);
    },
    onError: (e: any) => toast({ title: "Cannot change status", description: e.message, variant: "destructive" }),
  });

  const resetMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_reset_po_status", {
        _po_id: poId, _new_status: resetTo, _reason: reason.trim(),
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["po-status-events", poId] });
      toast({ title: "Status reset", description: "The change was recorded in the status history." });
      setResetOpen(false);
      setReason("");
    },
    onError: (e: any) => toast({ title: "Reset failed", description: e.message, variant: "destructive" }),
  });

  const { data: events } = useQuery({
    queryKey: ["po-status-events", poId],
    enabled: historyOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("po_status_events" as any)
        .select("id, from_status, to_status, reason, is_admin_reset, created_at")
        .eq("purchase_order_id", poId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const action = nextAction(status);
  const Icon = action?.icon;

  return (
    <div className="flex items-center gap-1">
      <Badge className={STATUS_COLOR[status] ?? ""} variant="secondary">{STATUS_LABEL[status] ?? status}</Badge>

      {action && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={advance.isPending}
          onClick={() => advance.mutate(action.to)}
          title={action.label}
        >
          {Icon && <Icon className="h-3 w-3 me-1" />}
          {action.label}
        </Button>
      )}

      {(status === "received" || status === "partially_received") && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setPayOpen(true)}
          title="Record the supplier payment"
        >
          <BadgeDollarSign className="h-3 w-3 me-1" />
          Pay supplier
        </Button>
      )}

      <PayPoDialog poId={poId} open={payOpen} onOpenChange={setPayOpen} />


      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Status options">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
            <History className="h-3.5 w-3.5 me-2" />Status history
          </DropdownMenuItem>
          {CANCELLABLE.includes(status) && (
            <DropdownMenuItem className="text-destructive" onClick={() => setConfirmCancel(true)}>
              <Ban className="h-3.5 w-3.5 me-2" />Cancel PO
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setResetTo(status); setResetOpen(true); }}>
                <RotateCcw className="h-3.5 w-3.5 me-2" />Admin: reset status
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Cancel confirmation */}
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this purchase order?</DialogTitle>
            <DialogDescription>
              Cancelling is final — the PO can no longer be sent, received or paid. It is only possible before goods are received.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>Keep PO</Button>
            <Button variant="destructive" disabled={advance.isPending} onClick={() => advance.mutate("cancelled")}>
              Cancel PO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin reset */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset purchase order status</DialogTitle>
            <DialogDescription>
              Administrative correction only. The previous status, the new status and your reason are permanently recorded.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>New status</Label>
              <Select value={resetTo} onValueChange={setResetTo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Reason (required)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this correction needed?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button disabled={resetMut.isPending || !reason.trim() || resetTo === status} onClick={() => resetMut.mutate()}>
              {resetMut.isPending ? "Saving…" : "Reset status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Status history</DialogTitle>
            <DialogDescription>Every status change recorded for this purchase order.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto text-sm">
            {!events?.length && <p className="text-muted-foreground">No status changes recorded yet.</p>}
            {events?.map((ev) => (
              <div key={ev.id} className="border rounded-md p-2">
                <div className="flex items-center justify-between">
                  <span>
                    {ev.from_status ? `${STATUS_LABEL[ev.from_status] ?? ev.from_status} → ` : ""}
                    <strong>{STATUS_LABEL[ev.to_status] ?? ev.to_status}</strong>
                  </span>
                  <span className="text-xs text-muted-foreground">{format(new Date(ev.created_at), "dd MMM yyyy HH:mm")}</span>
                </div>
                {ev.is_admin_reset && <Badge variant="secondary" className="mt-1 text-[10px]">Admin reset</Badge>}
                {ev.reason && <p className="text-xs text-muted-foreground mt-1">{ev.reason}</p>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
