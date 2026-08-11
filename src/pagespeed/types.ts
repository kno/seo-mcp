export type Strategy = "mobile" | "desktop";

export interface PageSpeedResult {
  url: string;
  strategy: Strategy;
  fetchedAt?: string;
  /** Lighthouse category score normalized and rounded to 0–100. */
  performanceScore?: number;
  /** Lighthouse category score normalized and rounded to 0–100. */
  accessibilityScore?: number;
  /** Lighthouse category score normalized and rounded to 0–100. */
  bestPracticesScore?: number;
  /** Lighthouse category score normalized and rounded to 0–100. */
  seoScore?: number;
  labMetrics: {
    firstContentfulPaintMs?: number;
    largestContentfulPaintMs?: number;
    totalBlockingTimeMs?: number;
    cumulativeLayoutShift?: number;
    speedIndexMs?: number;
  };
  fieldMetrics?: {
    overallCategory?: string;
    interactionToNextPaintMs?: number;
  };
  opportunities: Array<{
    id: string;
    title: string;
    savingsMs?: number;
    savingsBytes?: number;
  }>;
}
