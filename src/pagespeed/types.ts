import type * as z from "zod/v4";
import { pageSpeedResultSchema, strategySchema } from "../schemas/pagespeed";

export type Strategy = z.infer<typeof strategySchema>;

/**
 * Lighthouse category scores (`performanceScore`, `accessibilityScore`,
 * `bestPracticesScore`, `seoScore`) are normalized and rounded to 0–100.
 */
export type PageSpeedResult = z.infer<typeof pageSpeedResultSchema>;
