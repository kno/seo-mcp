/**
 * `keyword-research-view`'s "Google Ads Quota Is Displayed Independently of
 * Google Search Console Quota" requirement (task 8.5): a SECOND quota
 * indicator, visually and by accessible name distinct from both:
 * - the shared MCP rate-limit bucket (`HeadroomIndicator`/`UsageContainer`,
 *   wording "calls observed... of a ... window (estimate)"), and
 * - any Search Console quota indicator (none is currently rendered anywhere
 *   in this dashboard — `SearchConsoleContainer`/`GscInsightsContainer` both
 *   explicitly do not render `quota` — but this component's wording is
 *   unconditionally "Google Ads", never generic "quota", so it cannot be
 *   confused with one even if a sibling is added later).
 *
 * `QuotaEstimateView` is a LOCAL, UI-owned type mirroring
 * `bff/src/authenticated/quota-ledger.ts#QuotaEstimate`'s shape exactly —
 * deliberately NOT imported from that module. `quota-ledger.ts`'s exported
 * functions take `KVNamespace`/`ExecutionContext` parameters (Workers-only
 * globals), so importing anything from it — even a type-only import of a
 * plain-data interface it also exports — pulls the whole file into
 * `bff/ui`'s program under its DOM-only tsconfig (no `@cloudflare/workers-
 * types`), which fails to typecheck. This mirrors the same "re-export from a
 * schema module instead of the source module" workaround this session's
 * prior PRs already established for Cloudflare-specific source files.
 * `describeAdsQuotaEstimate`'s wording deliberately parallels
 * `quota-ledger.ts#describeQuotaEstimate`'s "at least N calls used in this
 * window" phrasing (same estimate-labelling discipline), as an independent
 * presentation-layer implementation, not a shared import.
 */
export interface QuotaEstimateView {
  readonly source: string;
  /** Under-estimate by construction — see `quota-ledger.ts`'s doc comment. */
  readonly atLeast: number;
  readonly budget: number;
  readonly basis: "bff-observed" | "unavailable";
}

export function describeAdsQuotaEstimate(quota: QuotaEstimateView): string {
  if (quota.basis === "unavailable") {
    return "Google Ads call volume for this window is currently unavailable.";
  }
  return `At least ${quota.atLeast} Google Ads calls used in this window (soft budget: ${quota.budget}).`;
}

export interface AdsQuotaBadgeProps {
  readonly quota: QuotaEstimateView;
}

export function AdsQuotaBadge({ quota }: AdsQuotaBadgeProps) {
  return (
    <span
      className="ads-quota-badge"
      data-testid="quota-badge-google-ads"
      role="status"
    >
      {describeAdsQuotaEstimate(quota)}
    </span>
  );
}
