import { describe, expect, it } from "vitest";
import {
  storedCrawlSnapshotSchema,
  crawlPageIssueChangeSchema,
  crawlDiffSchema,
} from "../../src/schemas/crawl-snapshots";

describe("storedCrawlSnapshotSchema", () => {
  it("accepts a real StoredCrawlSnapshot fixture", () => {
    const fixture = {
      id: 3,
      url: "https://example.com",
      capturedAt: "2026-01-01T00:00:00.000Z",
      label: "pre-launch",
      crawled: 18,
      failed: 2,
      issueCounts: { "missing-h1": 3, "thin-content": 1 },
    };
    expect(storedCrawlSnapshotSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a null label", () => {
    const fixture = {
      id: 3,
      url: "https://example.com",
      capturedAt: "2026-01-01T00:00:00.000Z",
      label: null,
      crawled: 18,
      failed: 2,
      issueCounts: {},
    };
    expect(storedCrawlSnapshotSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a missing label field (must be string | null, not optional)", () => {
    const fixture = {
      id: 3,
      url: "https://example.com",
      capturedAt: "2026-01-01T00:00:00.000Z",
      crawled: 18,
      failed: 2,
      issueCounts: {},
    };
    expect(() => storedCrawlSnapshotSchema.parse(fixture)).toThrow();
  });
});

describe("crawlPageIssueChangeSchema", () => {
  it("accepts a real CrawlPageIssueChange fixture", () => {
    const fixture = {
      page: "https://example.com/about",
      codes: ["missing-h1", "thin-content"],
    };
    expect(crawlPageIssueChangeSchema.parse(fixture)).toEqual(fixture);
  });
});

describe("crawlDiffSchema", () => {
  it("accepts a real CrawlDiff fixture with all five fields", () => {
    const fixture = {
      newPages: ["https://example.com/new"],
      removedPages: ["https://example.com/gone"],
      newIssues: [{ page: "https://example.com/about", codes: ["missing-h1"] }],
      resolvedIssues: [
        { page: "https://example.com/contact", codes: ["thin-content"] },
      ],
      issueCountDeltas: { "missing-h1": 1, "thin-content": -1 },
    };
    expect(crawlDiffSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a payload missing one of the five fields", () => {
    const fixture = {
      newPages: [],
      removedPages: [],
      newIssues: [],
      // resolvedIssues omitted
      issueCountDeltas: {},
    };
    expect(() => crawlDiffSchema.parse(fixture)).toThrow();
  });

  it("distinguishes new/resolved page-level issue changes from new/removed whole pages", () => {
    // The two bucket families are structurally different: newPages/removedPages
    // are string[] (a whole page appeared/disappeared), while
    // newIssues/resolvedIssues are CrawlPageIssueChange[] (an issue code
    // changed on a page present in BOTH snapshots).
    const fixture = {
      newPages: ["https://example.com/new"],
      removedPages: [],
      newIssues: [],
      resolvedIssues: [],
      issueCountDeltas: {},
    };
    const parsed = crawlDiffSchema.parse(fixture);
    expect(parsed.newPages).toEqual(["https://example.com/new"]);
    expect(parsed.newIssues).toEqual([]);
  });
});
