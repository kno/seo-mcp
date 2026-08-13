/**
 * Classifies raw upstream (Google) failure text into exactly four classes
 * and returns ONLY the class — the matched text is never echoed back, so a
 * decoy or real credential embedded in an upstream error string cannot
 * reach a caller through this function (design.md, "Decision: classify
 * failures at the BFF now; recommend server-side codes as a follow-up").
 *
 * Both failure paths in `src/google/search-console.ts` throw a plain
 * `Error`, so today this is the only mechanical way to distinguish
 * "credentials broken" from "quota exhausted" from "something else" — see
 * threat matrix row (d). The safe default for anything unmatched is
 * `tool_failed`, a NON-retryable, operator-facing failure: a classification
 * miss must never degrade into a retry loop against a broken credential or
 * an exhausted quota.
 *
 * `keyword-research-view` (PR8) extends the not-configured match to
 * `"Google Ads developer token is not configured"` AND `"Google Ads
 * customer ID is not configured"` — `src/google/ads.ts`'s own two guards
 * (deliberately NOT naming the Ads credential/customer-id env vars here;
 * see `bff/test/authenticated/containment.test.ts`'s structural fence,
 * which bans those identifiers from every `bff/src` file, comments
 * included), the exact same shape of "our own text, never Google's" as the
 * GSC constant below. Task 8.6's requirement — a missing Ads developer
 * token renders `upstream_source_not_configured`, distinct from an empty
 * result — applies equally to a missing customer ID: both are the same
 * "operator forgot to configure this source" state, not two different
 * failures, so both are two extra literals in the same exact-match set,
 * not a new classifier.
 */
import type { BffErrorCode } from "../errors";

const NOT_CONFIGURED_TEXTS = [
  "Google credentials are not configured",
  "Google Ads developer token is not configured",
  "Google Ads customer ID is not configured",
];

const CREDENTIAL_FAILURE_MARKERS = [
  "invalid_grant",
  "invalid_client",
  "unauthorized_client",
];

const SOURCE_QUOTA_MARKERS = [
  "quota",
  "rateLimitExceeded",
  "userRateLimitExceeded",
];

function includesAny(text: string, markers: string[]): boolean {
  return markers.some((marker) => text.includes(marker));
}

export function classifyUpstreamFailure(text: string): BffErrorCode {
  if (NOT_CONFIGURED_TEXTS.includes(text)) {
    return "upstream_source_not_configured";
  }
  if (includesAny(text, CREDENTIAL_FAILURE_MARKERS)) {
    return "upstream_credential_failure";
  }
  if (includesAny(text, SOURCE_QUOTA_MARKERS)) {
    return "upstream_source_quota";
  }
  // Safe default (design.md): unclassifiable is non-retryable, never a
  // retry loop against a broken credential or an exhausted quota.
  return "tool_failed";
}

/**
 * Classifies the `isError` text `gsc-insight-views`' three D1-backed
 * snapshot tools (`snapshot_search_console`, `list_search_console_snapshots`,
 * `compare_search_console`) can raise. Unlike `classifyUpstreamFailure`,
 * these two texts are OUR OWN constants (`src/server.ts`'s `if (!env.DB)
 * return errorResult(new Error("D1 storage is not configured"))` guard, and
 * `compare_search_console`'s own "Need at least two snapshots to compare"
 * message) — neither is Google-shaped text, so a separate classifier exists
 * rather than folding these two checks into `classifyUpstreamFailure` and
 * conflating a storage-configuration failure with a Google credential one.
 * Both distinguish from the safe `tool_failed` default for the same reason
 * `classifyUpstreamFailure` does: a missing D1 binding and a genuinely
 * insufficient snapshot count are each their own actionable state, not a
 * silent empty list/diff (`gsc-insight-views` spec, "fewer than two
 * snapshots is a distinct, actionable state").
 */
const D1_NOT_CONFIGURED_TEXT = "D1 storage is not configured";
const INSUFFICIENT_SNAPSHOTS_TEXT = "Need at least two snapshots to compare";

export function classifyStorageFailure(text: string): BffErrorCode {
  if (text === D1_NOT_CONFIGURED_TEXT) {
    return "upstream_storage_not_configured";
  }
  if (text === INSUFFICIENT_SNAPSHOTS_TEXT) {
    return "insufficient_snapshots";
  }
  return "tool_failed";
}
