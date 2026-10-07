import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, XCircle } from "lucide-react";

interface Props {
  status?: string | null;
  className?: string;
}

/**
 * Visual indicator for documents that go through the approval workflow.
 * Renders nothing when status is "not_required" or empty.
 */
export function ApprovalBadge({ status, className }: Props) {
  if (!status || status === "not_required") return null;
  if (status === "pending") {
    return (
      <Badge variant="outline" className={`gap-1 border-amber-500 text-amber-600 ${className ?? ""}`}>
        <Clock className="h-3 w-3" /> Awaiting approval
      </Badge>
    );
  }
  if (status === "approved") {
    return (
      <Badge variant="outline" className={`gap-1 border-emerald-500 text-emerald-600 ${className ?? ""}`}>
        <CheckCircle2 className="h-3 w-3" /> Approved
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge variant="outline" className={`gap-1 border-red-500 text-red-600 ${className ?? ""}`}>
        <XCircle className="h-3 w-3" /> Rejected
      </Badge>
    );
  }
  return null;
}
