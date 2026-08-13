import type { ReactNode } from "react";

/**
 * Severity/status marker, reused across issue severity, probe state, and
 * cache status per `design.md`'s shared-primitives list. `unmapped` is a
 * variant for a code the presentation table does not recognize — still
 * visibly distinct, never silently dropped. `broken` and `error` are
 * `broken-links-view`'s two `LinkProbe.state` failure classes: a `broken`
 * probe returned an HTTP 4xx/5xx status from the target, while an `error`
 * probe never reached the target at all (unreachable, invalid URL, or
 * timeout). They must render as visually distinct markers so the two
 * failure classes are never collapsed into one generic "failed" bucket.
 */
export type BadgeVariant = "warning" | "info" | "unmapped" | "broken" | "error";

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
