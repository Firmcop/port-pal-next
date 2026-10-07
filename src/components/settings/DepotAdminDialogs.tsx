import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Crown, ShieldAlert, CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { useOrganization } from "@/hooks/use-organization";

/** Fetch the org toggle for dual approval on HQ ops (default true). */
function useDualApprovalRequired() {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["org-dual-approval", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("config")
        .eq("id", organizationId!)
        .maybeSingle();
      const v = (data as any)?.config?.require_dual_approval_for_hq_ops;
      return v === false ? false : true;
    },
  });
}

export function PromoteToHqDialog({
  open,
  onOpenChange,
  depot,
  currentHqName,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  depot: { id: string; name: string; code: string };
  currentHqName?: string | null;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: dual = true } = useDualApprovalRequired();

  const run = useMutation({
    mutationFn: async () => {
      if (dual) {
        const { data, error } = await supabase.rpc("request_depot_hq_promotion" as any, { _depot_id: depot.id });
        if (error) throw error;
        return { requested: true, data };
      }
      const { error } = await supabase.rpc("set_depot_as_hq" as any, { _depot_id: depot.id });
      if (error) throw error;
      return { requested: false };
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["depots"] });
      qc.invalidateQueries({ queryKey: ["depot-lifecycle-events"] });
      if (res.requested) {
        toast({
          title: "Approval requested",
          description: `Awaiting a second administrator to approve promoting ${depot.name} to HQ. Open Approvals to review.`,
        });
      } else {
        toast({ title: "HQ updated", description: `${depot.name} is now the Headquarters.` });
      }
      onDone();
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-amber-500" />
            Promote to Headquarters
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {currentHqName ? (
                  <>
                    <b>{currentHqName}</b> will be demoted to a Branch and <b>{depot.name}</b> becomes
                    the new Headquarters. HQ-level controls move to this depot.
                  </>
                ) : (
                  <>
                    <b>{depot.name}</b> will be set as the Headquarters for the organization.
                  </>
                )}
              </p>
              {dual && (
                <p className="text-xs text-muted-foreground">
                  This action requires approval from a second administrator before it takes effect.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={run.isPending}
            onClick={(e) => {
              e.preventDefault();
              run.mutate();
            }}
          >
            {run.isPending ? "Working..." : dual ? "Request promotion" : "Promote to HQ"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type PreviewResult = {
  ok: boolean;
  target_hq: { id: string; name: string; code: string };
  counts: Record<string, number>;
  container_sample: Array<{ id: string; container_no: string; status: string }>;
  block_sample: Array<{ id: string; name: string }>;
  transferable: Array<{ key: string; label: string; count: number }>;
  blockers: Array<{ key: string; label: string; count: number }>;
  ready: boolean;
};

export function RetireDepotDialog({
  open,
  onOpenChange,
  depot,
  hqDepot,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  depot: { id: string; name: string; code: string };
  hqDepot: { id: string; name: string } | null;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: dual = true } = useDualApprovalRequired();
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmCode, setConfirmCode] = useState("");

  const reset = () => {
    setPreview(null);
    setConfirmCode("");
  };

  const previewMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("preview_depot_retirement" as any, {
        _depot_id: depot.id,
        _target_hq_id: hqDepot!.id,
      });
      if (error) throw error;
      return data as PreviewResult;
    },
    onSuccess: (data) => setPreview(data),
    onError: (e: any) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const finalize = useMutation({
    mutationFn: async () => {
      if (dual) {
        const { data, error } = await supabase.rpc("request_depot_retirement" as any, {
          _depot_id: depot.id,
          _target_hq_id: hqDepot!.id,
          _preview: preview ?? {},
        });
        if (error) throw error;
        return { requested: true, data };
      }
      const { data, error } = await supabase.rpc("retire_depot" as any, {
        _depot_id: depot.id,
        _target_hq_id: hqDepot!.id,
        _confirm_reconciled: true,
      });
      if (error) throw error;
      return { requested: false, data };
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["depots"] });
      qc.invalidateQueries({ queryKey: ["yard-blocks-all"] });
      qc.invalidateQueries({ queryKey: ["depot-lifecycle-events"] });
      if (res.requested) {
        toast({
          title: "Approval requested",
          description: `Awaiting a second administrator to approve retiring ${depot.name}.`,
        });
      } else {
        toast({
          title: "Depot retired",
          description: `${depot.name} has been transferred to HQ and removed.`,
        });
      }
      onDone();
      onOpenChange(false);
      reset();
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const canFinalize =
    !!preview?.ready && confirmCode.trim().toUpperCase() === depot.code.toUpperCase();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            Retire depot — preview &amp; reconcile with HQ
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                Retiring <b>{depot.name}</b> transfers records to{" "}
                {hqDepot ? (
                  <>
                    HQ <Badge variant="secondary">{hqDepot.name}</Badge>
                  </>
                ) : (
                  <b>the Headquarters</b>
                )}
                . Run the preview to see exactly what will move and what is blocking.
              </p>
              {!hqDepot && (
                <p className="text-destructive text-sm">
                  No Headquarters is configured. Set an HQ before retiring a branch.
                </p>
              )}
              {dual && (
                <p className="text-xs text-muted-foreground">
                  A second administrator must approve the retirement before it takes effect.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {preview && (
          <div className="space-y-4 max-h-[55vh] overflow-y-auto">
            <section className="border rounded-md p-3 space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                Blockers — must be cleared first
              </h4>
              {preview.blockers.length === 0 ? (
                <p className="text-xs text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> No blockers. Ready to reconcile.
                </p>
              ) : (
                preview.blockers.map((b) => (
                  <BlockerRow key={b.key} label={b.label} count={b.count} />
                ))
              )}
            </section>

            <section className="border rounded-md p-3 space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <ChevronRight className="h-4 w-4" /> Will be transferred to {preview.target_hq.name}
              </h4>
              {preview.transferable.map((t) => (
                <div key={t.key} className="flex items-center justify-between text-sm">
                  <span>{t.label}</span>
                  <Badge variant={t.count === 0 ? "outline" : "secondary"}>{t.count}</Badge>
                </div>
              ))}
              {preview.container_sample.length > 0 && (
                <div className="text-xs text-muted-foreground pt-1">
                  <b>Containers preview:</b>{" "}
                  {preview.container_sample.map((c) => c.container_no).join(", ")}
                  {preview.counts.active_containers > preview.container_sample.length && " …"}
                </div>
              )}
              {preview.block_sample.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <b>Yard blocks:</b> {preview.block_sample.map((b) => b.name).join(", ")}
                </div>
              )}
            </section>

            {preview.ready && (
              <div className="space-y-2">
                <p className="text-sm">
                  Type the depot code{" "}
                  <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{depot.code}</code>{" "}
                  to confirm.
                </p>
                <Input
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  className="font-mono"
                />
              </div>
            )}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          {!preview ? (
            <Button
              variant="secondary"
              disabled={!hqDepot || previewMut.isPending}
              onClick={() => previewMut.mutate()}
            >
              {previewMut.isPending ? "Checking..." : "Run reconciliation preview"}
            </Button>
          ) : !preview.ready ? (
            <Button variant="secondary" disabled={previewMut.isPending} onClick={() => previewMut.mutate()}>
              {previewMut.isPending ? "Re-checking..." : "Re-run preview"}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={!canFinalize || finalize.isPending}
              onClick={() => finalize.mutate()}
            >
              {finalize.isPending
                ? "Working..."
                : dual
                ? "Request retirement approval"
                : "Transfer to HQ & delete"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function BlockerRow({ label, count }: { label: string; count: number }) {
  const ok = count === 0;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" />
        )}
        {label}
      </span>
      <Badge variant={ok ? "secondary" : "destructive"}>{count}</Badge>
    </div>
  );
}
