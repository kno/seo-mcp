/**
 * The authenticated tool registry — an explicit, exhaustively enumerated
 * allowlist, NOT a passthrough over every tool `seo-mcp` registers (design.md,
 * "Decision: the authenticated registry is an allowlist, and Business Profile
 * is not in it"). A tool this map does not name is unreachable through the
 * BFF, not merely un-navigated — the concrete hazard this defends against is
 * the three live public `business_*` write tools (`business_reply_review`,
 * `business_update_info`, `business_create_post`).
 *
 * `AUTHENTICATED_REGISTRY`'s entries are typed so `schema` MUST be one of the
 * schemas re-exported from `src/types/schemas.ts` (the published schema map)
 * — the same reconciliation gate `dashboard-bff-foundations` established for
 * the crawl tools. A tool with no published `outputSchema` cannot be added
 * here without a typecheck error; the six `business_*` tools have none, so
 * they are excluded by construction, not merely by omission.
 *
 * `gsc-insight-views` (PR6) adds five more rows, all under the same
 * `"search-console"` source. They split into two profiles:
 *
 * - `callsGoogleUpstream: true` — `find_striking_distance_keywords`,
 *   `find_low_ctr_opportunities`, `snapshot_search_console` each make a real
 *   Search Console call in their own request path, exactly like
 *   `search_console_query`. They use `classify.ts#classifyUpstreamFailure`
 *   (Google-shaped error text) and spend the upstream quota ledger on every
 *   real attempt.
 * - `callsGoogleUpstream: false` — `list_search_console_snapshots` and
 *   `compare_search_console` only read (and, for the latter, diff) rows
 *   already stored in D1 by an earlier `snapshot_search_console` call. They
 *   make no Google call at all, so they use
 *   `classify.ts#classifyStorageFailure` (our own D1-guard/insufficient-
 *   snapshots text, never Google's) and never increment the Google quota
 *   ledger — a D1 read spends no Google quota, and counting it would make
 *   the "at least N calls used" estimate drift upward for a call that never
 *   touched Google.
 *
 * `freshnessDate` resolves the calendar date `authenticated/freshness.ts`'s
 * `deriveSourceFreshness` derives its `SourceFreshness` from, since only
 * three of the five tools have a request-level `endDate` to read directly:
 * - The three live-Google tools (plus `search_console_query`) read the
 *   request's own `endDate` — unchanged from `search_console_query`'s
 *   existing behavior.
 * - `list_search_console_snapshots` has no `endDate` input at all, so it
 *   reads the most-recently-captured stored snapshot's own `endDate`
 *   instead (the list is already ordered most-recent-first) — a real
 *   calendar fact from the result, never a fabricated "today".
 * - `compare_search_console`'s result (`{ siteUrl, baseSnapshotId,
 *   currentSnapshotId, diff }`) carries no date field at all — see
 *   `design.md`'s reconciliation table, "the two staleness axes for a
 *   comparison's baseline period specifically" was left open pending this
 *   phase. This envelope-level field therefore falls back to today's date;
 *   it is NOT what satisfies `gsc-insight-views`' "reporting lag applies to
 *   every GSC-backed tool" requirement for the comparison specifically —
 *   that requirement is satisfied by the VIEW rendering each snapshot's own
 *   `capturedAt` (looked up via `list_search_console_snapshots`, the same
 *   lookup task 6.4's label/date-range display already needs), per the
 *   spec's own words: "the 'as-of' fact for each side of the comparison is
 *   that snapshot's own `capturedAt` timestamp... not the moment the
 *   comparison was computed."
 */
import * as publishedSchemas from "../../../src/types/schemas";

export type AuthenticatedSource = "search-console";

type PublishedSchema = (typeof publishedSchemas)[keyof typeof publishedSchemas];

export interface AuthenticatedRouteDefinition {
  source: AuthenticatedSource;
  schema: PublishedSchema;
  /** Above `gscTimeoutMs + googleTokenTimeoutMs` (15s + 10s) with margin,
   * per design.md's timeout table, for a tool with `callsGoogleUpstream:
   * true`; a generous D1-read budget otherwise. */
  timeoutMs: number;
  /** Whether this route makes a real Google Search Console call in its own
   * request path. Governs which classifier `dispatchAuthenticated()` uses
   * and whether the upstream quota ledger increments on a real attempt. */
  callsGoogleUpstream: boolean;
  /** Resolves the calendar date `sourceFreshness` is derived from — see this
   * module's doc comment for why this cannot always be `args.endDate`. */
  freshnessDate: (args: Record<string, unknown>, data: unknown) => string;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Every live-Google GSC tool (this registry's `search_console_query` and
 * three of the five `gsc-insight-views` tools) has a request-level
 * `endDate: YYYY-MM-DD` — the same field `search_console_query` has always
 * used for freshness derivation. */
function fromRequestEndDate(args: Record<string, unknown>): string {
  return typeof args.endDate === "string" ? args.endDate : todayIsoDate();
}

/** `list_search_console_snapshots` has no request `endDate`; its own result
 * (`{ siteUrl, count, snapshots: StoredSnapshot[] }`, ordered most-recent-
 * first) carries a real one instead — the most-recently-captured snapshot's
 * own `endDate`. Falls back to today only when the result is empty or not
 * yet available (e.g. an error response, where this value is never read). */
function fromMostRecentSnapshotEndDate(
  _args: Record<string, unknown>,
  data: unknown,
): string {
  if (data && typeof data === "object" && "snapshots" in data) {
    const snapshots = (data as { snapshots?: unknown }).snapshots;
    if (Array.isArray(snapshots) && snapshots.length > 0) {
      const endDate = (snapshots[0] as { endDate?: unknown }).endDate;
      if (typeof endDate === "string") return endDate;
    }
  }
  return todayIsoDate();
}

/** `compare_search_console`'s result carries no date field at all — see this
 * module's doc comment. Documented fallback, not the mechanism that
 * satisfies the comparison's own as-of requirement (the view renders each
 * snapshot's `capturedAt` directly instead). */
function todayAsFreshnessFallback(): string {
  return todayIsoDate();
}

export const AUTHENTICATED_REGISTRY = {
  search_console_query: {
    source: "search-console",
    schema: publishedSchemas.gscQueryResultSchema,
    timeoutMs: 27_000,
    callsGoogleUpstream: true,
    freshnessDate: fromRequestEndDate,
  },
  find_striking_distance_keywords: {
    source: "search-console",
    schema: publishedSchemas.opportunityResultSchema,
    timeoutMs: 27_000,
    callsGoogleUpstream: true,
    freshnessDate: fromRequestEndDate,
  },
  find_low_ctr_opportunities: {
    source: "search-console",
    schema: publishedSchemas.opportunityResultSchema,
    timeoutMs: 27_000,
    callsGoogleUpstream: true,
    freshnessDate: fromRequestEndDate,
  },
  snapshot_search_console: {
    source: "search-console",
    schema: publishedSchemas.snapshotSearchConsoleResultSchema,
    timeoutMs: 28_000,
    callsGoogleUpstream: true,
    freshnessDate: fromRequestEndDate,
  },
  list_search_console_snapshots: {
    source: "search-console",
    schema: publishedSchemas.listSearchConsoleSnapshotsResultSchema,
    timeoutMs: 10_000,
    callsGoogleUpstream: false,
    freshnessDate: fromMostRecentSnapshotEndDate,
  },
  compare_search_console: {
    source: "search-console",
    schema: publishedSchemas.compareSearchConsoleResultSchema,
    timeoutMs: 10_000,
    callsGoogleUpstream: false,
    freshnessDate: todayAsFreshnessFallback,
  },
} satisfies Record<string, AuthenticatedRouteDefinition>;

export type AuthenticatedToolName = keyof typeof AUTHENTICATED_REGISTRY;

export function isAuthenticatedTool(
  name: string,
): name is AuthenticatedToolName {
  return Object.prototype.hasOwnProperty.call(AUTHENTICATED_REGISTRY, name);
}

export function getAuthenticatedRoute(
  name: string,
): AuthenticatedRouteDefinition | undefined {
  return isAuthenticatedTool(name) ? AUTHENTICATED_REGISTRY[name] : undefined;
}
