import * as z from "zod/v4";

// Google Ads Keyword Planner. See `src/google/ads.ts:F3` — no currency field
// exists anywhere in the upstream response; bid fields are bare numbers.
export const keywordMetricSchema = z.object({
  keyword: z.string(),
  avgMonthlySearches: z.number(),
  competition: z.string(),
  competitionIndex: z.number(),
  lowTopOfPageBid: z.number(),
  highTopOfPageBid: z.number(),
});
export type KeywordMetric = z.infer<typeof keywordMetricSchema>;

// Shared result shape for `get_keyword_metrics` and `discover_keywords`.
export const keywordMetricsResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  customerId: z.string(),
  count: z.number().int().min(0),
  keywords: z.array(keywordMetricSchema),
});
export type KeywordMetricsResult = z.infer<typeof keywordMetricsResultSchema>;

// `src/seo/keywords.ts` clustering.
export const keywordIntentSchema = z.enum([
  "transactional",
  "commercial",
  "informational",
  "local",
]);
export type KeywordIntent = z.infer<typeof keywordIntentSchema>;

export const classifiedKeywordSchema = z.object({
  keyword: z.string(),
  intent: keywordIntentSchema,
  tokens: z.array(z.string()),
});
export type ClassifiedKeyword = z.infer<typeof classifiedKeywordSchema>;

export const keywordClusterSchema = z.object({
  label: z.string(),
  keywords: z.array(z.string()),
});
export type KeywordCluster = z.infer<typeof keywordClusterSchema>;

export const clusterResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  count: z.number().int().min(0),
  intents: z.record(z.string(), z.number()),
  clusters: z.array(keywordClusterSchema),
  keywords: z.array(classifiedKeywordSchema),
});
export type ClusterResult = z.infer<typeof clusterResultSchema>;
