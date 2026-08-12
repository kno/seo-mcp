import * as z from "zod/v4";

export const jsonLdSummarySchema = z.object({
  blocks: z.number(),
  types: z.array(z.string()),
  invalid: z.number(),
});

export const seoIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["warning", "info"]),
  message: z.string(),
});

export const pageAnalysisSchema = z.object({
  url: z.string(),
  status: z.number(),
  bytesRead: z.number(),
  title: z.string(),
  description: z.string(),
  canonical: z.string().optional(),
  robots: z.string().optional(),
  lang: z.string().optional(),
  h1: z.array(z.string()),
  h2: z.array(z.string()),
  h3: z.array(z.string()),
  links: z.array(z.string()),
  internalLinkTargets: z.array(z.string()),
  internalLinks: z.number(),
  externalLinks: z.number(),
  imageCount: z.number(),
  imagesMissingAlt: z.number(),
  openGraph: z.record(z.string(), z.string()),
  jsonLd: jsonLdSummarySchema,
  wordCount: z.number(),
  indexable: z.boolean(),
  issues: z.array(seoIssueSchema),
  fetchTimeMs: z.number().optional(),
});
