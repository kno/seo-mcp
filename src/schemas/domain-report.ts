import * as z from "zod/v4";
import { siteCrawlResultSchema } from "./site";
import { opportunitySchema } from "./intelligence";

// `analyze_domain`'s `crawl` sub-object reuses `siteCrawlResultSchema`'s
// existing `summary`/`crawlPolicy`/`linkGraph` sub-schemas directly rather
// than restating them, per `buildDomainReport` (`src/seo/domain-report.ts`).
export const domainReportCrawlSchema = z.object({
  sitemapFound: z.boolean(),
  crawled: z.number(),
  failed: z.number(),
  issueCounts: z.record(z.string(), z.number()),
  summary: siteCrawlResultSchema.shape.summary,
  crawlPolicy: siteCrawlResultSchema.shape.crawlPolicy,
  linkGraph: siteCrawlResultSchema.shape.linkGraph,
});
export type DomainReportCrawl = z.infer<typeof domainReportCrawlSchema>;

export const domainSearchSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  opportunities: z.array(opportunitySchema),
});
export type DomainSearch = z.infer<typeof domainSearchSchema>;

// `search` (GSC enrichment succeeded) and `gscError` (GSC enrichment
// failed) are both optional, and the real tool (`buildDomainReport`) never
// sets both at once — enforced here at the schema level via `.refine()` so
// the mutual-exclusivity invariant of the real `DomainReport` shape is a
// structural fact of this schema, not just an implementation detail.
export const domainReportSchema = z
  .object({
    // OBJECT ROOT — required by the SDK
    url: z.string(),
    crawl: domainReportCrawlSchema,
    search: domainSearchSchema.optional(),
    gscError: z.string().optional(),
  })
  .refine(
    (data) => !(data.search !== undefined && data.gscError !== undefined),
    {
      message: "search and gscError are mutually exclusive",
    },
  );
export type DomainReport = z.infer<typeof domainReportSchema>;
