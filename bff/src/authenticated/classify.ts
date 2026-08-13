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
 */
import type { BffErrorCode } from "../errors";

const NOT_CONFIGURED_TEXT = "Google credentials are not configured";

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
  if (text === NOT_CONFIGURED_TEXT) return "upstream_source_not_configured";
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
