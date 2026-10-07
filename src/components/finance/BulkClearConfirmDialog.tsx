import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  count: number;
  totalDebit: number;
  totalCredit: number;
  conflictCount: number;
  onConfirm: (skipConflicts: boolean) => void;
  loading?: boolean;
};

export function BulkClearConfirmDialog({ open, onOpenChange, count, totalDebit, totalCredit, conflictCount, onConfirm, loading }: Props) {
  const [skip, setSkip] = useState(true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CheckCircle className="h-5 w-5 text-success" />Confirm bulk clear</DialogTitle>
          <DialogDescription>This will mark {count} statement line{count === 1 ? "" : "s"} as cleared and write a single audit-log entry.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded border p-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Lines</span><span className="font-mono">{count}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Total debit</span><span className="font-mono">{totalDebit.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Total credit</span><span className="font-mono">{totalCredit.toFixed(2)}</span></div>
          {conflictCount > 0 && (
            <div className="flex justify-between text-warning">
              <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Flagged with conflicts</span>
              <span className="font-mono">{conflictCount}</span>
            </div>
          )}
        </div>

        {conflictCount > 0 && (
          <div className="flex items-center justify-between rounded border p-3">
            <Label htmlFor="skip-conflicts" className="text-sm">Skip flagged rows</Label>
            <Switch id="skip-conflicts" checked={skip} onCheckedChange={setSkip} />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={() => onConfirm(skip)} disabled={loading}>
            {loading ? "Applying…" : `Clear ${count} line${count === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
