import * as z from "zod/v4";

export const strategySchema = z.enum(["mobile", "desktop"]);

export const pageSpeedResultSchema = z.object({
  url: z.string(),
  strategy: strategySchema,
  fetchedAt: z.string().optional(),
  performanceScore: z.number().optional(),
  accessibilityScore: z.number().optional(),
  bestPracticesScore: z.number().optional(),
  seoScore: z.number().optional(),
  labMetrics: z.object({
    firstContentfulPaintMs: z.number().optional(),
    largestContentfulPaintMs: z.number().optional(),
    totalBlockingTimeMs: z.number().optional(),
    cumulativeLayoutShift: z.number().optional(),
    speedIndexMs: z.number().optional(),
  }),
  fieldMetrics: z
    .object({
      overallCategory: z.string().optional(),
      interactionToNextPaintMs: z.number().optional(),
    })
    .optional(),
  opportunities: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      savingsMs: z.number().optional(),
      savingsBytes: z.number().optional(),
    }),
  ),
});
