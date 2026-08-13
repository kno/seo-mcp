import * as z from "zod/v4";

// ---------------------------------------------------------------------------
// find_seo_opportunities / find_keyword_cannibalization
// ---------------------------------------------------------------------------

export const opportunityTypeSchema = z.enum([
  "low_ctr",
  "striking_distance",
  "cannibalization",
]);
export type OpportunityType = z.infer<typeof opportunityTypeSchema>;

export const opportunitySchema = z.object({
  type: opportunityTypeSchema,
  query: z.string(),
  page: z.string().nullable(),
  impressions: z.number(),
  currentPosition: z.number().nullable(),
  // `impact`/`effort`/`priorityScore` are confirmed open-ended and
  // unnormalized by the real synthesis helpers (`effort` happens to be a
  // fixed 1/2/3 per-type constant in practice, but the schema does not
  // constrain it — the source doesn't).
  impact: z.number(),
  effort: z.number(),
  priorityScore: z.number(),
  recommendation: z.string(),
});
export type Opportunity = z.infer<typeof opportunitySchema>;

export const cannibalPageSchema = z.object({
  page: z.string(),
  clicks: z.number(),
  impressions: z.number(),
  position: z.number(),
});
export type CannibalPage = z.infer<typeof cannibalPageSchema>;

export const cannibalGroupSchema = z.object({
  query: z.string(),
  pageCount: z.number().int().min(0),
  totalImpressions: z.number(),
  totalClicks: z.number(),
  pages: z.array(cannibalPageSchema),
});
export type CannibalGroup = z.infer<typeof cannibalGroupSchema>;

// `find_keyword_cannibalization` and `find_seo_opportunities` return
// `{ siteUrl, startDate, endDate, count, <array> }` with NO `criteria`
// field — unlike `OpportunityResult`, which echoes it. These schemas
// deliberately never define one: a plain (non-strict) `z.object()` means an
// extraneous `criteria` key on the wire is silently stripped rather than
// preserved, so a later tool-side addition of a real `criteria` field is a
// visible, deliberate schema change here, not something that starts
// silently passing through unnoticed.

export const findKeywordCannibalizationResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  siteUrl: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  count: z.number().int().min(0),
  groups: z.array(cannibalGroupSchema),
});
export type FindKeywordCannibalizationResult = z.infer<
  typeof findKeywordCannibalizationResultSchema
>;

export const findSeoOpportunitiesResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  siteUrl: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  count: z.number().int().min(0),
  opportunities: z.array(opportunitySchema),
});
export type FindSeoOpportunitiesResult = z.infer<
  typeof findSeoOpportunitiesResultSchema
>;

// ---------------------------------------------------------------------------
// map_keywords_to_pages / find_content_gaps
// ---------------------------------------------------------------------------

export const pageQuerySchema = z.object({
  query: z.string(),
  clicks: z.number(),
  impressions: z.number(),
  position: z.number(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const pageKeywordsSchema = z.object({
  page: z.string(),
  queryCount: z.number().int().min(0),
  totalClicks: z.number(),
  totalImpressions: z.number(),
  topQueries: z.array(pageQuerySchema),
});
export type PageKeywords = z.infer<typeof pageKeywordsSchema>;

export const mapKeywordsToPagesResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  siteUrl: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  count: z.number().int().min(0),
  pages: z.array(pageKeywordsSchema),
});
export type MapKeywordsToPagesResult = z.infer<
  typeof mapKeywordsToPagesResultSchema
>;

export const contentGapSchema = z.object({
  query: z.string(),
  page: z.string(),
  impressions: z.number(),
  clicks: z.number(),
  position: z.number(),
});
export type ContentGap = z.infer<typeof contentGapSchema>;

export const findContentGapsResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  siteUrl: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  count: z.number().int().min(0),
  gaps: z.array(contentGapSchema),
});
export type FindContentGapsResult = z.infer<typeof findContentGapsResultSchema>;
