/**
 * Published runtime Zod schemas for the MCP tools with a published output
 * schema. Depends only on `zod` — never on `src/http`, `src/crawl`, `src/seo`, or
 * `src/pagespeed` runtime modules — so a consumer that wants to validate a
 * result at runtime (rather than only type-check it) can import from here
 * without pulling in Worker-specific code.
 */
export { healthSchema } from "../schemas/health";
export { pageAnalysisSchema } from "../schemas/page";
export {
  siteCrawlResultSchema,
  sitePageAnalysisSchema,
  domainSummarySchema,
  crawlPolicySchema,
  linkGraphSummarySchema,
  domainCategorySchema,
  duplicateGroupSchema,
} from "../schemas/site";
export { linkCheckResultSchema, linkProbeSchema } from "../schemas/links";
export { pageSpeedResultSchema, strategySchema } from "../schemas/pagespeed";
export {
  gscQueryResultSchema,
  gscRowSchema,
  gscDimensionSchema,
} from "../schemas/search-console";
export { opportunityResultSchema } from "../schemas/opportunities";
export {
  storedSnapshotSchema,
  gscMetricsSchema,
  gscDiffRowSchema,
  gscDiffSchema,
  snapshotSearchConsoleResultSchema,
  listSearchConsoleSnapshotsResultSchema,
  compareSearchConsoleResultSchema,
} from "../schemas/gsc-snapshots";
