import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { ReactNode } from "react";

export function BulkActionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="sticky top-0 z-20 -mx-1 px-3 py-2 mb-3 rounded-md border border-primary/30 bg-primary/10 shadow-sm flex items-center gap-2 flex-wrap">
      <span className="text-sm font-medium">{count} selected</span>
      <div className="h-4 w-px bg-border mx-1" />
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
      <Button variant="ghost" size="sm" className="ms-auto" onClick={onClear}>
        <X className="h-4 w-4 me-1" /> Clear
      </Button>
    </div>
  );
}
