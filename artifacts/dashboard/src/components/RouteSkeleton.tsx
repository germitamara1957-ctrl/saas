import { Skeleton } from "@/components/ui/skeleton";

/**
 * Generic page skeleton shown while a lazy-loaded route chunk is downloading.
 *
 * Mirrors the typical dashboard page shape (header → 4 stat cards → table)
 * so the layout doesn't shift when the real content paints. Reduces perceived
 * loading time vs. a centred spinner.
 */
export function RouteSkeleton() {
  return (
    <div
      className="space-y-6 p-6"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      {/* 4 stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Table-like list */}
      <div className="rounded-lg border">
        <div className="border-b p-4">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 p-4">
              <div className="flex flex-1 items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
      </div>

      <span className="sr-only">Loading page content…</span>
    </div>
  );
}
