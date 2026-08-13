import type { ReactNode } from "react";

/**
 * Severity/status marker, reused across issue severity, probe state, and
 * cache status per `design.md`'s shared-primitives list. `unmapped` is a
 * fourth variant for a code the presentation table does not recognize —
 * still visibly distinct, never silently dropped.
 */
export type BadgeVariant = "warning" | "info" | "unmapped";

export interface BadgeProps {
  readonly variant: BadgeVariant;
  readonly children: ReactNode;
}

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span data-testid={`badge-${variant}`} data-variant={variant}>
      {children}
    </span>
  );
}
