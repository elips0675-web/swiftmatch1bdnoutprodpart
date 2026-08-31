import { cn } from "@/lib/utils";

export function HangoutSkeletonCard({ className }: { className?: string }) {
  return (
    <div
      data-testid="hangout-skeleton"
      className={cn("rounded-2xl border border-border bg-card p-4 space-y-3", className)}
      aria-hidden="true"
    >
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-full bg-muted animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-24 rounded bg-muted animate-pulse" />
          <div className="h-3 w-16 rounded bg-muted animate-pulse" />
        </div>
      </div>
      <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
      <div className="h-3 w-full rounded bg-muted animate-pulse" />
      <div className="h-10 rounded-xl bg-muted animate-pulse" />
      <div className="flex gap-2">
        <div className="h-8 w-20 rounded-lg bg-muted animate-pulse" />
        <div className="h-8 w-20 rounded-lg bg-muted animate-pulse" />
      </div>
    </div>
  );
}
