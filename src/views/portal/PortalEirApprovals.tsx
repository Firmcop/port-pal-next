import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClipboardCheck } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

type Row = {
  id: string;
  eir_number: string;
  eir_type: string;
  created_at: string;
  container_number: string;
  container_size: string;
  condition_grade: string;
  owner_at_issue: string | null;
  new_owner: string | null;
  gate_fee_amount: number | null;
  gate_fee_currency: string | null;
  approval_status: string;
};

const tone: Record<string, string> = {
  pending: "border-amber-500 text-amber-600",
  approved: "border-emerald-500 text-emerald-600",
  rejected: "border-red-500 text-red-600",
  not_required: "text-muted-foreground",
};

export default function PortalEirApprovals() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reject, setReject] = useState<Row | null>(null);
  const [reason, setReason] = useState("");

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["portal-eirs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("portal_pending_eirs");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision, note }: { id: string; decision: "approved" | "rejected"; note?: string }) => {
      const { error } = await (supabase as any).rpc("portal_decide_eir", {
        _eir_id: id,
        _decision: decision,
        _note: note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-eirs"] });
      setReject(null);
      setReason("");
      toast({ title: "Recorded", description: "Thank you — your decision has been sent to the depot." });
    },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const pending = rows.filter((r) => r.approval_status === "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardCheck className="h-6 w-6" />Equipment receipts</h1>
        <p className="text-sm text-muted-foreground">
          Approve or reject each equipment interchange receipt for your containers. {pending.length} awaiting your decision.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Receipts</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>EIR #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Gate fee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !rows.length ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No receipts yet</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm">{r.eir_number}</TableCell>
                  <TableCell className="capitalize text-sm">{r.eir_type.replace("_", " ")}</TableCell>
                  <TableCell className="font-mono text-sm">{r.container_number} <span className="text-muted-foreground">{r.container_size}ft</span></TableCell>
                  <TableCell className="text-sm">{r.condition_grade}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {r.gate_fee_amount ? `${r.gate_fee_currency ?? ""} ${Number(r.gate_fee_amount).toLocaleString()}` : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(r.created_at), "PPp")}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={tone[r.approval_status] ?? ""}>
                      {r.approval_status === "pending" ? "Awaiting your approval" : r.approval_status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.approval_status === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setReject(r); setReason(""); }}>Reject</Button>
                        <Button size="sm" onClick={() => decide.mutate({ id: r.id, decision: "approved" })} disabled={decide.isPending}>Approve</Button>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!reject} onOpenChange={(v) => !v && setReject(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject {reject?.eir_number}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tell the depot what is wrong so they can correct it.</p>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. condition grade does not match the unit received" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReject(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || decide.isPending}
              onClick={() => reject && decide.mutate({ id: reject.id, decision: "rejected", note: reason.trim() })}
            >
              Reject receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
