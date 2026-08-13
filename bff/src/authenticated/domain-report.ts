/**
 * `analyze_domain`'s `gscError` classify-and-discard transform (design.md,
 * "Decision: `analyze_domain`'s `gscError` is classified like a failure,
 * though it arrives as a success"; threat row g).
 *
 * Every other authenticated failure path arrives as an `isError` text
 * result, which `mcp-client.ts` intercepts via `classifyFailureText` BEFORE
 * `dispatchAuthenticated()` ever sees a successful `McpClientResult`.
 * `analyze_domain` is the one exception: `buildDomainReport`
 * (`src/seo/domain-report.ts:34-48, 95-98`) sets `gscError` to a raw
 * upstream `Error.message` on an otherwise-successful 200-OK `DomainReport`.
 * A classifier that only inspects `isError` results would forward Google's
 * verbatim text to the browser through a SUCCESS envelope — routing around
 * the classify-and-discard rule rather than defeating it directly.
 *
 * `classifyDomainReportGscError` runs unconditionally on every successful
 * `analyze_domain` result (`bff/src/authenticated/registry.ts`'s
 * `transformSuccess` hook, read by `bff/src/router.ts#dispatchAuthenticated`
 * immediately after a real upstream call succeeds, before the result is
 * cached or returned):
 * - No `gscError` present (enrichment not requested, or it succeeded and
 *   `search` is present instead — the two are mutually exclusive per
 *   `domainReportSchema`'s `.refine()`) — the report passes through
 *   unchanged.
 * - `gscError` present — it is run through `classify.ts#classifyUpstreamFailure`
 *   (the SAME classifier every other Google-shaped upstream failure in this
 *   chain uses; `analyze_domain`'s enrichment step is itself a
 *   `findSeoOpportunities` call against Search Console, so its failure text
 *   is Google-shaped, not a distinct shape needing its own classifier), the
 *   class is surfaced as a NEW `enrichmentError: { code }` field, and the
 *   raw string is destructured out of the returned object and never
 *   referenced again — it cannot reach the response body, the cache value,
 *   an export, or a log line, because nothing downstream of this function
 *   ever receives it.
 *
 * `forceOpenTtl: true` on a classified failure tells the router to cache
 * the report at the `authenticated-delayed` cache class's `open` TTL rather
 * than `closed`, regardless of the requested range's own state — "the
 * failure is transient in a way the crawl portion is not" (design.md).
 */
import { classifyUpstreamFailure } from "./classify";

export interface DomainReportTransformResult {
  readonly data: unknown;
  readonly forceOpenTtl: boolean;
}

function hasStringGscError(
  value: unknown,
): value is Record<string, unknown> & { gscError: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).gscError === "string"
  );
}

export function classifyDomainReportGscError(
  raw: unknown,
): DomainReportTransformResult {
  if (!hasStringGscError(raw)) {
    return { data: raw, forceOpenTtl: false };
  }

  // Destructured out of `raw`'s own spread below — `gscError` (the local
  // binding) is read exactly once, by `classifyUpstreamFailure`, and then
  // never assigned anywhere else. It does not appear in `rest`, the
  // function's return value, or anywhere reachable after this line.
  const { gscError, ...rest } = raw;
  const code = classifyUpstreamFailure(gscError);

  return {
    data: { ...rest, enrichmentError: { code } },
    forceOpenTtl: true,
  };
}
