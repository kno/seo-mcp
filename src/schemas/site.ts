import * as z from "zod/v4";
import { pageAnalysisSchema } from "./page";

export const domainCategorySchema = z.object({
  count: z.number(),
  sample: z.array(z.string()),
});

export const duplicateGroupSchema = z.object({
  value: z.string(),
  count: z.number(),
  sample: z.array(z.string()),
});

export const domainSummarySchema = z.object({
  pagesAnalyzed: z.number(),
  duplicateTitles: z.array(duplicateGroupSchema),
  duplicateDescriptions: z.array(duplicateGroupSchema),
  missingH1: domainCategorySchema,
  multipleH1: domainCategorySchema,
  thinContent: domainCategorySchema,
  nonIndexable: domainCategorySchema,
  imagesMissingAlt: z.object({ pages: z.number(), images: z.number() }),
});

export const crawlPolicySchema = z.object({
  robotsUrl: z.string(),
  robotsFound: z.boolean(),
  userAgent: z.string(),
  sitemapsDeclared: z.array(z.string()),
  disallowedSkipped: z.object({
    count: z.number(),
    sample: z.array(z.string()),
  }),
});

export const linkGraphSummarySchema = z.object({
  crawledPages: z.number(),
  orphanPages: z.object({ count: z.number(), sample: z.array(z.string()) }),
  topLinkedPages: z.array(z.object({ url: z.string(), inbound: z.number() })),
});

export const sitePageAnalysisSchema = pageAnalysisSchema
  .omit({ links: true, internalLinkTargets: true })
  .extend({ linkCount: z.number() });

export const siteCrawlResultSchema = z.object({
  site: z.string(),
  sitemap: z.string(),
  sitemapFound: z.boolean(),
  crawlPolicy: crawlPolicySchema,
  requested: z.number(),
  crawled: z.number(),
  failed: z.number(),
  documentsRead: z.number(),
  subrequests: z.number(),
  bytesRead: z.number(),
  outputBytes: z.number(),
  pages: z.array(
    z.object({
      url: z.string(),
      result: sitePageAnalysisSchema.optional(),
      error: z.string().optional(),
    }),
  ),
  issueCounts: z.record(z.string(), z.number()),
  summary: domainSummarySchema,
  linkGraph: linkGraphSummarySchema,
});
