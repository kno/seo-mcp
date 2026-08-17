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

/**
 * `domain-google-credentials` Phase 6 / `quota-visibility`'s "The quota
 * estimate is labeled with which account it describes" requirement:
 * mirrors the authenticated envelope's `credential` field
 * (`router.ts#authenticatedToolResponse`'s doc comment) closely enough to
 * name the account, without importing anything Workers-only — same
 * re-derive-the-shape-locally discipline this module's own top doc comment
 * already applies to `QuotaEstimateView`.
 */
export interface AccountCredentialView {
  readonly source: "site" | "global";
  readonly accountLabel: string | null;
}

/** "operator's shared account" for the global tier — never a bare number,
 * and never the literal string "global" a user has no context for. */
function describeAccount(credential: AccountCredentialView): string {
  if (credential.source === "site" && credential.accountLabel) {
    return credential.accountLabel;
  }
  return "operator's shared account";
}

export function describeAdsQuotaEstimate(
  quota: QuotaEstimateView,
  credential: AccountCredentialView,
): string {
  const account = describeAccount(credential);
  if (quota.basis === "unavailable") {
    return `Google Ads call volume for ${account} is currently unavailable.`;
  }
  return `At least ${quota.atLeast} Google Ads calls used in this window for ${account} (soft budget: ${quota.budget}).`;
}

export interface AdsQuotaBadgeProps {
  readonly quota: QuotaEstimateView;
  readonly credential: AccountCredentialView;
}

export function AdsQuotaBadge({ quota, credential }: AdsQuotaBadgeProps) {
  return (
    <span
      className="ads-quota-badge"
      data-testid="quota-badge-google-ads"
      role="status"
    >
      {describeAdsQuotaEstimate(quota, credential)}
    </span>
  );
}
