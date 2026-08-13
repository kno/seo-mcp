/**
 * Effective-criteria resolver for `seo-intelligence-view`'s five tools
 * (`find_seo_opportunities`, `find_keyword_cannibalization`,
 * `map_keywords_to_pages`, `find_content_gaps`, `analyze_domain`) — NONE of
 * which echoes any criteria field in its own result (design.md, "Decision:
 * effective request criteria are echoed by the BFF, because five tools echo
 * none"). Each default below mirrors the exact `?? <default>` fallback the
 * real synthesis helper applies (`src/seo/intelligence.ts`,
 * `src/seo/keyword-pages.ts`, `src/seo/domain-report.ts`), so the BFF's
 * echoed `criteria` can never drift from what the tool itself actually
 * did — an OMITTED request field resolves to the SAME default named here,
 * never a UI-side guess (task 10.2's "a request that omitted the limit
 * entirely must still get a correct bound label" — this is what makes that
 * possible: the BFF, not the tool, knows the effective limit).
 *
 * `basis: "request"` marks this criteria object as BFF-derived from the
 * request — textually distinct from `OpportunityResult.criteria`
 * (`find_striking_distance_keywords`/`find_low_ctr_opportunities`, PR6),
 * which the TOOL itself echoes. This module never touches that other
 * mechanism; the two `criteria`-shaped fields are never merged or compared
 * beyond both being visible in their respective views.
 */

export type SeoIntelligenceToolName =
  | "find_seo_opportunities"
  | "find_keyword_cannibalization"
  | "map_keywords_to_pages"
  | "find_content_gaps"
  | "analyze_domain";

export interface EffectiveCriteria {
  readonly basis: "request";
  readonly [field: string]: number | "request";
}

/**
 * Mirrors the exact defaults `src/seo/intelligence.ts`, `src/seo/keyword-
 * pages.ts` and `src/seo/domain-report.ts` apply via `?? <default>` when a
 * request field is omitted. `analyze_domain`'s only criteria-shaped field is
 * `opportunityLimit` (the limit `findSeoOpportunities` applies to its GSC
 * enrichment step) — `limit`/`concurrency` govern the crawl, not a
 * criteria-shaped threshold, so they are deliberately excluded here.
 */
const DEFAULTS: Record<
  SeoIntelligenceToolName,
  Readonly<Record<string, number>>
> = {
  find_seo_opportunities: { limit: 10 },
  find_keyword_cannibalization: { minImpressions: 10, limit: 50 },
  map_keywords_to_pages: { limit: 100, topQueriesPerPage: 10 },
  find_content_gaps: { minPosition: 21, minImpressions: 10, limit: 100 },
  analyze_domain: { opportunityLimit: 10 },
};

/**
 * Every one of the five tools synthesizes over a hardcoded `maxGscRows`
 * (250, `src/config.ts`) raw Search Console pull that NO output field
 * records — so this caveat is stated unconditionally by every view that
 * renders one of these five tools' results, never inferred from a field
 * (task 10.3). Exported as a single string constant so no view can drift
 * from another's wording.
 */
export const GSC_PULL_CAVEAT =
  "Derived from at most 250 Search Console rows pulled before any filter or limit is applied — a result below any shown limit is not necessarily exhaustive.";

/**
 * Resolves the EFFECTIVE (post-default-resolution) criteria for `tool`
 * given the validated request `args` — every field the request omitted
 * resolves to the same default `src/seo/*` itself applies, so this object
 * can never disagree with what the tool actually did.
 */
export function resolveEffectiveCriteria(
  tool: SeoIntelligenceToolName,
  args: Readonly<Record<string, unknown>>,
): EffectiveCriteria {
  const defaults = DEFAULTS[tool];
  const criteria: Record<string, number> = {};
  for (const [field, fallback] of Object.entries(defaults)) {
    const raw = args[field];
    criteria[field] = typeof raw === "number" ? raw : fallback;
  }
  return { basis: "request", ...criteria };
}
