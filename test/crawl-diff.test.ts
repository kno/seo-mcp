import { describe, expect, it } from "vitest";
import { diffCrawls } from "../src/seo/crawl-diff";
import { LIMITS } from "../src/config";
import type { CrawlSnapshotPage } from "../src/seo/crawl-diff";

function page(url: string, codes: string[]): CrawlSnapshotPage {
  return { page: url, issueCodes: codes };
}

describe("diffCrawls", () => {
  it("detects new and removed pages sorted ascending", () => {
    const base = [page("/a", []), page("/b", [])];
    const current = [page("/b", []), page("/c", []), page("/d", [])];
    const diff = diffCrawls(base, current);
    expect(diff.newPages).toEqual(["/c", "/d"]);
    expect(diff.removedPages).toEqual(["/a"]);
  });

  it("detects new and resolved issues on shared pages", () => {
    const base = [page("/p", ["MISSING_H1", "THIN_CONTENT"])];
    const current = [page("/p", ["THIN_CONTENT", "NO_META_DESCRIPTION"])];
    const diff = diffCrawls(base, current);
    expect(diff.newIssues).toEqual([
      { page: "/p", codes: ["NO_META_DESCRIPTION"] },
    ]);
    expect(diff.resolvedIssues).toEqual([
      { page: "/p", codes: ["MISSING_H1"] },
    ]);
  });

  it("excludes shared pages with no code change", () => {
    const base = [page("/p", ["A", "B"])];
    const current = [page("/p", ["B", "A"])];
    const diff = diffCrawls(base, current);
    expect(diff.newIssues).toEqual([]);
    expect(diff.resolvedIssues).toEqual([]);
  });

  it("computes signed issueCountDeltas over all pages, non-zero only", () => {
    const base = [page("/a", ["X"]), page("/b", ["X", "Y"])];
    const current = [page("/a", ["X"]), page("/c", ["Y", "Y"])];
    // X: base 2, current 1 => -1 ; Y: base 1, current 2 => +1
    const diff = diffCrawls(base, current);
    expect(diff.issueCountDeltas).toEqual({ X: -1, Y: 1 });
  });

  it("sorts issue changes by page ascending", () => {
    const base = [page("/z", []), page("/a", [])];
    const current = [page("/z", ["N"]), page("/a", ["N"])];
    const diff = diffCrawls(base, current);
    expect(diff.newIssues.map((c) => c.page)).toEqual(["/a", "/z"]);
  });

  it("caps new/removed pages and issue changes at LIMITS.maxCrawlDiffRows", () => {
    const original = LIMITS.maxCrawlDiffRows;
    (LIMITS as { maxCrawlDiffRows: number }).maxCrawlDiffRows = 2;
    try {
      const current = Array.from({ length: 5 }, (_, i) => page(`/n${i}`, []));
      const base = Array.from({ length: 5 }, (_, i) => page(`/o${i}`, []));
      const diff = diffCrawls(base, current);
      expect(diff.newPages).toHaveLength(2);
      expect(diff.removedPages).toHaveLength(2);

      const sharedBase = Array.from({ length: 5 }, (_, i) =>
        page(`/s${i}`, []),
      );
      const sharedCurrent = Array.from({ length: 5 }, (_, i) =>
        page(`/s${i}`, ["NEW"]),
      );
      const diff2 = diffCrawls(sharedBase, sharedCurrent);
      expect(diff2.newIssues).toHaveLength(2);
    } finally {
      (LIMITS as { maxCrawlDiffRows: number }).maxCrawlDiffRows = original;
    }
  });

  it("handles empty inputs deterministically", () => {
    const diff = diffCrawls([], []);
    expect(diff).toEqual({
      newPages: [],
      removedPages: [],
      newIssues: [],
      resolvedIssues: [],
      issueCountDeltas: {},
    });
  });
});
