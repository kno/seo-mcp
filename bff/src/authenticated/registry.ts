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
 */
import * as publishedSchemas from "../../../src/types/schemas";

export type AuthenticatedSource = "search-console";

type PublishedSchema = (typeof publishedSchemas)[keyof typeof publishedSchemas];

interface AuthenticatedRouteDefinition {
  source: AuthenticatedSource;
  schema: PublishedSchema;
  /** Above `gscTimeoutMs + googleTokenTimeoutMs` (15s + 10s) with margin,
   * per design.md's timeout table. */
  timeoutMs: number;
}

export const AUTHENTICATED_REGISTRY = {
  search_console_query: {
    source: "search-console",
    schema: publishedSchemas.gscQueryResultSchema,
    timeoutMs: 27_000,
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
