import * as z from "zod/v4";

/**
 * A page-scoped issue change between two crawl snapshots: `codes` are the
 * issue codes that were added (`newIssues`) or removed (`resolvedIssues`) on
 * `page` between the base and current snapshot. Only produced for a page
 * present in BOTH snapshots — an entirely new or removed page is reported
 * through `CrawlDiff.newPages`/`removedPages` instead, never here (see
 * `crawlDiffSchema`'s own doc comment for why the two bucket families are
 * kept structurally separate rather than folded into one generic list).
 */
export const crawlPageIssueChangeSchema = z.object({
  page: z.string().min(1),
  codes: z.array(z.string()),
});
export type CrawlPageIssueChange = z.infer<typeof crawlPageIssueChangeSchema>;

/**
 * `compare_crawls`' diff shape (`src/seo/crawl-diff.ts#diffCrawls`) — a
 * DIFFERENT bucket shape than `GscDiff` (four direction buckets over the
 * same row type). Crawl diffs split into two distinct kinds of change,
 * never conflated into one list:
 *
 * - `newPages`/`removedPages` (`string[]`): a page appeared in the current
 *   snapshot that was absent from the base one, or vice versa. Presence is
 *   determined purely by URL membership; a page's own issues are irrelevant
 *   to this bucket.
 * - `newIssues`/`resolvedIssues` (`CrawlPageIssueChange[]`): for a page
 *   present in BOTH snapshots, an issue CODE was added or removed on it.
 *   A page that disappeared entirely never contributes to `resolvedIssues`
 *   for its old issues — that page's departure is reported once, in
 *   `removedPages`, not once per issue it used to have.
 * - `issueCountDeltas` (`Record<string, number>`): the aggregate net change
 *   in how many pages carry each issue code, across the WHOLE site (not
 *   scoped to any one page) — a page-count delta, not a per-page fact.
 *
 * Each of `newPages`/`removedPages`/`newIssues`/`resolvedIssues` is
 * truncated independently to `LIMITS.maxCrawlDiffRows`
 * (`src/seo/crawl-diff.ts`) — one bucket reaching that cap says nothing
 * about any other bucket's own state, mirroring `GscDiff`'s same
 * per-bucket-independent truncation.
 */
export const crawlDiffSchema = z.object({
  newPages: z.array(z.string()),
  removedPages: z.array(z.string()),
  newIssues: z.array(crawlPageIssueChangeSchema),
  resolvedIssues: z.array(crawlPageIssueChangeSchema),
  issueCountDeltas: z.record(z.string(), z.number()),
});
export type CrawlDiff = z.infer<typeof crawlDiffSchema>;

/**
 * `src/db/crawl-store.ts`'s stored-row shape, returned by
 * `list_crawl_snapshots`/read by `compare_crawls`. `label` is `string |
 * null` (explicit, never optional) — mirrors `storedSnapshotSchema`'s own
 * discipline in `src/schemas/gsc-snapshots.ts` for the identical reason: a
 * caller must distinguish "no label was ever set" from "the label field is
 * absent from this payload".
 */
export const storedCrawlSnapshotSchema = z.object({
  id: z.number().int(),
  url: z.string().min(1),
  capturedAt: z.string(),
  label: z.string().nullable(),
  crawled: z.number().int().min(0),
  failed: z.number().int().min(0),
  issueCounts: z.record(z.string(), z.number()),
});
export type StoredCrawlSnapshot = z.infer<typeof storedCrawlSnapshotSchema>;

// ---------------------------------------------------------------------------
// Tool result shapes (src/server.ts) — the object roots the three
// crawl-snapshot tool registrations actually return.
// ---------------------------------------------------------------------------

export const snapshotCrawlResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  snapshotId: z.number().int(),
  url: z.string().min(1),
  pageCount: z.number().int().min(0),
  capturedAt: z.string(),
});
export type SnapshotCrawlResult = z.infer<typeof snapshotCrawlResultSchema>;

export const listCrawlSnapshotsResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  url: z.string().min(1),
  count: z.number().int().min(0),
  snapshots: z.array(storedCrawlSnapshotSchema),
});
export type ListCrawlSnapshotsResult = z.infer<
  typeof listCrawlSnapshotsResultSchema
>;

export const compareCrawlsResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  url: z.string().min(1),
  baseSnapshotId: z.number().int(),
  currentSnapshotId: z.number().int(),
  diff: crawlDiffSchema,
});
export type CompareCrawlsResult = z.infer<typeof compareCrawlsResultSchema>;
