/**
 * Renders a `KeywordMetricsResult` (`get_keyword_metrics` / `discover_keywords`,
 * shared shape — `keyword-research-view`). Two requirements drive this
 * component, both amended by reconciliation against the real `KeywordMetric`
 * shape (`src/google/ads.ts:9-16`, no currency field anywhere):
 *
 * - **Monetary values never render without a currency label.** `currencyLabel`
 *   comes from the BFF's authenticated envelope (operator config,
 *   `bff/wrangler.jsonc`'s `ADS_BID_CURRENCY_LABEL`), never from this
 *   result's own fields — there is no currency field to read. When it is
 *   `undefined` (operator has not configured one), every bid cell renders an
 *   explicit "Currency not configured" state instead of a bare or guessed
 *   number (task 8.2).
 * - **A `0` never claims certainty.** `normalizeMetric`
 *   (`src/google/ads.ts:26-51`) computes every numeric field as
 *   `Number(value) || 0`, so Google Ads returning no data and Google Ads
 *   returning an explicit zero are indistinguishable in the tool's own
 *   output. `renderMetricValue`/`renderBidValue` label a `0` as "0 (or not
 *   reported)" rather than a confirmed zero (task 8.3).
 */
import type { KeywordMetricsResult } from "../../../../src/types";

export interface KeywordMetricsTableProps {
  readonly result: KeywordMetricsResult;
  /** `undefined` when the operator has not configured
   * `ADS_BID_CURRENCY_LABEL` — see this module's doc comment. */
  readonly currencyLabel?: string;
}

function renderMetricValue(value: number): string {
  return value === 0 ? "0 (or not reported)" : String(value);
}

function renderBidValue(value: number, currencyLabel?: string): string {
  if (currencyLabel === undefined) {
    return "Currency not configured";
  }
  return value === 0
    ? `0 ${currencyLabel} (or not reported)`
    : `${value.toFixed(2)} ${currencyLabel}`;
}

export function KeywordMetricsTable({
  result,
  currencyLabel,
}: KeywordMetricsTableProps) {
  if (result.count === 0) {
    return (
      <p className="empty-state" data-testid="keyword-metrics-empty-state">
        No keyword metrics returned for this request.
      </p>
    );
  }

  return (
    <div className="table-scroll">
      {currencyLabel === undefined && (
        <p
          className="alert"
          role="alert"
          data-testid="ads-currency-not-configured"
        >
          Bid values cannot be shown: the operator has not configured a currency
          label for Google Ads bid data (`ADS_BID_CURRENCY_LABEL`).
        </p>
      )}
      <table aria-label="Keyword metrics">
        <thead>
          <tr>
            <th scope="col">Keyword</th>
            <th scope="col">Avg. monthly searches</th>
            <th scope="col">Competition</th>
            <th scope="col">Competition index</th>
            <th scope="col">Low top-of-page bid</th>
            <th scope="col">High top-of-page bid</th>
          </tr>
        </thead>
        <tbody>
          {result.keywords.map((metric) => (
            <tr key={metric.keyword}>
              <td>{metric.keyword}</td>
              <td>{renderMetricValue(metric.avgMonthlySearches)}</td>
              <td>{metric.competition}</td>
              <td>{renderMetricValue(metric.competitionIndex)}</td>
              <td>{renderBidValue(metric.lowTopOfPageBid, currencyLabel)}</td>
              <td>{renderBidValue(metric.highTopOfPageBid, currencyLabel)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
