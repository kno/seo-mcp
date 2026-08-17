export interface Env {
  MCP_AUTH_TOKEN?: string;
  MCP_RATE_LIMITER?: RateLimit;
  PAGESPEED_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_CUSTOMER_ID?: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  GSC_SNAPSHOT_PROPERTIES?: string;
  GOOGLE_BUSINESS_ACCOUNT?: string;
  GOOGLE_BUSINESS_LOCATION?: string;
  DOMAIN_CREDENTIAL_ENCRYPTION_KEY?: string;
  DB?: D1Database;
}

export const FREE_PLAN_SUBREQUEST_CEILING = 50;

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
  maxCannibalizationGroups: 50,
  maxLinkChecks: 40,
  linkCheckConcurrency: 6,
  linkProbeTimeoutMs: 6_000,
  linkCheckSubrequestBudget: 48,
  maxGscRows: 250,
  gscTimeoutMs: 15_000,
  googleTokenTimeoutMs: 10_000,
  maxKeywords: 100,
  maxKeywordIdeas: 200,
  adsTimeoutMs: 20_000,
  maxClusterKeywords: 500,
  maxSnapshotRows: 500,
  maxDiffRows: 100,
  maxKeywordPages: 100,
  maxContentGaps: 100,
  maxCrawlSnapshotPages: 100,
  maxCrawlDiffRows: 100,
  maxBusinessReviews: 50,
  businessTimeoutMs: 20_000,
} as const;
