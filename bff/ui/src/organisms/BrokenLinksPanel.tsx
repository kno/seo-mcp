import type { LinkCheckResult } from "../../../../src/types";
import { ProbeRow } from "../molecules/ProbeRow";

/**
 * Renders a `LinkCheckResult` (`broken-links-view`'s "Checked, OK, Broken,
 * and Errors Counts Are Always Visible" requirement). All four counts —
 * `checked`, `ok`, `broken`, `errors` — always render together as distinct
 * figures, never only a subset, so a bounded probe set can never present as
 * a clean bill of health by omission (the "zero broken alongside checked"
 * scenario). Only the non-`"ok"` probes are listed individually via
 * `ProbeRow`, since the panel's purpose is surfacing what needs attention;
 * the four counts above already cover the aggregate `ok` figure. Pure
 * presentational component — no data fetching, per `design.md`'s
 * organism/container boundary.
 */
export interface BrokenLinksPanelProps {
  readonly result: LinkCheckResult;
}

export function BrokenLinksPanel({ result }: BrokenLinksPanelProps) {
  const problems = result.results.filter((probe) => probe.state !== "ok");

  return (
    <section aria-label="Broken links">
      <dl>
        <dt>Checked</dt>
        <dd data-testid="links-checked">{result.checked}</dd>
        <dt>OK</dt>
        <dd data-testid="links-ok">{result.ok}</dd>
        <dt>Broken</dt>
        <dd data-testid="links-broken">{result.broken}</dd>
        <dt>Errors</dt>
        <dd data-testid="links-errors">{result.errors}</dd>
      </dl>

      {problems.length === 0 ? (
        <p>No broken or unreachable links found.</p>
      ) : (
        <ul aria-label="Problem links">
          {problems.map((probe) => (
            <ProbeRow key={probe.url} probe={probe} />
          ))}
        </ul>
      )}
    </section>
  );
}
