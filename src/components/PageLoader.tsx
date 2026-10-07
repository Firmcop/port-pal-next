import { Skeleton } from "@/components/ui/skeleton";

/** Shown while a screen's code chunk downloads. Mirrors a typical list page. */
export function PageLoader() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function FullScreenLoader() {
  return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
}
