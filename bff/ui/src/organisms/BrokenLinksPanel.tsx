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
    <section className="panel" aria-label="Broken links">
      <h3>Link check</h3>
      {/* All four figures always render together, as four equally-weighted
          stat cards. The colour treatment follows the figure's own meaning
          (`ok` green, `broken` red, `errors` amber) and never suppresses a
          zero — a zero-broken result is a green "0", not an omitted card. */}
      <dl className="stat-grid">
        <div className="stat">
          <dt>Checked</dt>
          <dd data-testid="links-checked">{result.checked}</dd>
        </div>
        <div className="stat stat-ok">
          <dt>OK</dt>
          <dd data-testid="links-ok">{result.ok}</dd>
        </div>
        <div className={result.broken > 0 ? "stat stat-danger" : "stat"}>
          <dt>Broken</dt>
          <dd data-testid="links-broken">{result.broken}</dd>
        </div>
        <div className={result.errors > 0 ? "stat stat-warn" : "stat"}>
          <dt>Errors</dt>
          <dd data-testid="links-errors">{result.errors}</dd>
        </div>
      </dl>

      {problems.length === 0 ? (
        <p className="empty-state empty-state-ok">
          No broken or unreachable links found.
        </p>
      ) : (
        <ul className="item-list" aria-label="Problem links">
          {problems.map((probe) => (
            <ProbeRow key={probe.url} probe={probe} />
          ))}
        </ul>
      )}
    </section>
  );
}
