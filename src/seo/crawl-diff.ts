import type * as z from "zod/v4";
import { LIMITS } from "../config";
import {
  crawlPageIssueChangeSchema,
  crawlDiffSchema,
} from "../schemas/crawl-snapshots";

export interface CrawlSnapshotPage {
  page: string;
  issueCodes: string[];
}

export type CrawlPageIssueChange = z.infer<typeof crawlPageIssueChangeSchema>;

export type CrawlDiff = z.infer<typeof crawlDiffSchema>;

function indexByPage(
  pages: CrawlSnapshotPage[],
): Map<string, CrawlSnapshotPage> {
  const map = new Map<string, CrawlSnapshotPage>();
  for (const page of pages) {
    if (!map.has(page.page)) map.set(page.page, page);
  }
  return map;
}

function countCodes(pages: CrawlSnapshotPage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const code of page.issueCodes) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return counts;
}

const asc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function diffCrawls(
  base: CrawlSnapshotPage[],
  current: CrawlSnapshotPage[],
): CrawlDiff {
  const baseMap = indexByPage(base);
  const currentMap = indexByPage(current);
  const cap = LIMITS.maxCrawlDiffRows;

  const newPages: string[] = [];
  const removedPages: string[] = [];
  const newIssues: CrawlPageIssueChange[] = [];
  const resolvedIssues: CrawlPageIssueChange[] = [];

  for (const [page] of currentMap) {
    if (!baseMap.has(page)) newPages.push(page);
  }
  for (const [page] of baseMap) {
    if (!currentMap.has(page)) removedPages.push(page);
  }

  for (const [page, currentPage] of currentMap) {
    const basePage = baseMap.get(page);
    if (!basePage) continue;
    const baseCodes = new Set(basePage.issueCodes);
    const currentCodes = new Set(currentPage.issueCodes);
    const added = [...currentCodes].filter((c) => !baseCodes.has(c)).sort(asc);
    const removed = [...baseCodes]
      .filter((c) => !currentCodes.has(c))
      .sort(asc);
    if (added.length > 0) newIssues.push({ page, codes: added });
    if (removed.length > 0) resolvedIssues.push({ page, codes: removed });
  }

  newPages.sort(asc);
  removedPages.sort(asc);
  newIssues.sort((a, b) => asc(a.page, b.page));
  resolvedIssues.sort((a, b) => asc(a.page, b.page));

  const baseCounts = countCodes(base);
  const currentCounts = countCodes(current);
  const issueCountDeltas: Record<string, number> = {};
  const codes = new Set<string>([
    ...baseCounts.keys(),
    ...currentCounts.keys(),
  ]);
  for (const code of [...codes].sort(asc)) {
    const delta = (currentCounts.get(code) ?? 0) - (baseCounts.get(code) ?? 0);
    if (delta !== 0) issueCountDeltas[code] = delta;
  }

  return {
    newPages: newPages.slice(0, cap),
    removedPages: removedPages.slice(0, cap),
    newIssues: newIssues.slice(0, cap),
    resolvedIssues: resolvedIssues.slice(0, cap),
    issueCountDeltas,
  };
}
