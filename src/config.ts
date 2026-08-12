export interface Env {
  MCP_AUTH_TOKEN?: string;
  MCP_RATE_LIMITER?: RateLimit;
  PAGESPEED_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
}

export const LIMITS = {
  fetchTimeoutMs: 8_000,
  maxHtmlBytes: 256_000,
  maxSitemapBytes: 256_000,
  maxSiteResponseBytes: 3_000_000,
  maxSiteOutputBytes: 256_000,
  maxJsonBytes: 2_000_000,
  defaultCrawlPages: 10,
  maxCrawlPages: 20,
  maxConcurrency: 4,
  maxSitemapDocuments: 5,
  maxSitemapLocations: 100,
  maxRedirects: 3,
  maxOpportunities: 10,
  maxLinkChecks: 50,
  linkCheckConcurrency: 6,
  linkProbeTimeoutMs: 6_000,
  linkCheckSubrequestBudget: 60,
  maxGscRows: 250,
  gscTimeoutMs: 15_000,
  googleTokenTimeoutMs: 10_000,
} as const;
