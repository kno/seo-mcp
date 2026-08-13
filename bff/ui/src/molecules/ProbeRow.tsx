import { Badge } from "../atoms/Badge";
import type { BadgeVariant } from "../atoms/Badge";
import type { LinkProbe } from "../../../../src/types";

/**
 * One probed link (`broken-links-view`'s "Broken and Error States Render
 * Distinctly" requirement). `LinkProbe.state` carries three mutually
 * exclusive values from the real `check_links` result shape
 * (`src/crawl/links.ts`): `"ok"`, `"broken"` (4xx/5xx from the target — a
 * content fix), and `"error"` (unreachable target, invalid URL, or
 * timeout — a reachability investigation). Each renders its own `Badge`
 * variant and its own detail — `status` for `broken`, `error` for
 * `error` — never merged into one generic "failed" indicator. Pure
 * presentational component: no data fetching, per `design.md`'s
 * organism/molecule boundary.
 */
export interface ProbeRowProps {
  readonly probe: LinkProbe;
}

function variantFor(state: LinkProbe["state"]): BadgeVariant {
  if (state === "broken") return "broken";
  if (state === "error") return "error";
  return "info";
}

export function ProbeRow({ probe }: ProbeRowProps) {
  return (
    <li>
      <span>{probe.url}</span>
      <Badge variant={variantFor(probe.state)}>{probe.state}</Badge>
      {probe.state === "broken" && (
        <span data-testid="probe-status">{probe.status}</span>
      )}
      {probe.state === "error" && (
        <span data-testid="probe-error">{probe.error}</span>
      )}
    </li>
  );
}
