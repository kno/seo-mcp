/**
 * CSV export. `design.md` deliberately left the exact `SiteCrawlResult`
 * column layout open and instead specified a seam (`CsvShape<T>` +
 * `CSV_SHAPES`) so any resolution plugs in without touching call sites.
 *
 * CSV shape decision (this phase resolves the open question): **one flat
 * per-page/per-probe/per-opportunity row**, not a multi-section sheet.
 * Rationale: every published result type this dashboard exports either IS
 * already a flat record (`crawl_page`) or nests exactly ONE array whose
 * entries are the natural "row" (`crawl_site.pages`, `check_links.results`,
 * `analyze_pagespeed.opportunities`) — a single flat sheet keeps the
 * golden/stability invariant trivial (no row-count-dependent section
 * headers to keep in sync) and keeps every row independently meaningful in
 * a spreadsheet, which a multi-section sheet does not. Aggregate/nested
 * fields that don't fit a per-row column (e.g. `SiteCrawlResult.summary`,
 * `SiteCrawlResult.crawlPolicy`, `LinkCheckResult.results` itself) are
 * listed in `omitted` — per the "field with no defined column is
 * explicitly noted, not dropped silently" scenario — and are still fully
 * available via the JSON export's `result-export` "JSON export is a
 * faithful representation" guarantee, which never drops anything. Bound/
 * sample provenance for those omitted aggregate fields is carried in the
 * CSV's own leading comment block via `collectBounds`, not lost.
 */
import type { PageAnalysis } from "../../../../src/seo/html";
import type {
  LinkCheckResult,
  PageSpeedResult,
  SiteCrawlResult,
} from "../../../../src/types";
import type { Bound } from "../data/bounds";

export interface CsvShape<T> {
  readonly id: string;
  readonly columns: readonly string[];
  rows(result: T): ReadonlyArray<ReadonlyArray<string>>;
  /** Top-level fields of the published result type with no defined column. */
  readonly omitted: readonly string[];
}

function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number")
    return String(value);
  return JSON.stringify(value);
}

const crawlPageShape: CsvShape<PageAnalysis> = {
  id: "crawl_page",
  columns: [
    "url",
    "status",
    "bytesRead",
    "title",
    "description",
    "canonical",
    "robots",
    "lang",
    "h1",
    "h2",
    "h3",
    "links",
    "internalLinkTargets",
    "internalLinks",
    "externalLinks",
    "imageCount",
    "imagesMissingAlt",
    "openGraph",
    "jsonLd.blocks",
    "jsonLd.types",
    "jsonLd.invalid",
    "wordCount",
    "indexable",
    "issues",
    "fetchTimeMs",
  ],
  rows(result) {
    return [
      [
        cell(result.url),
        cell(result.status),
        cell(result.bytesRead),
        cell(result.title),
        cell(result.description),
        cell(result.canonical),
        cell(result.robots),
        cell(result.lang),
        cell(result.h1.join("; ")),
        cell(result.h2.join("; ")),
        cell(result.h3.join("; ")),
        cell(result.links.join("; ")),
        cell(result.internalLinkTargets.join("; ")),
        cell(result.internalLinks),
        cell(result.externalLinks),
        cell(result.imageCount),
        cell(result.imagesMissingAlt),
        cell(result.openGraph),
        cell(result.jsonLd.blocks),
        cell(result.jsonLd.types.join("; ")),
        cell(result.jsonLd.invalid),
        cell(result.wordCount),
        cell(result.indexable),
        cell(result.issues),
        cell(result.fetchTimeMs),
      ],
    ];
  },
  omitted: [],
};

const crawlSiteShape: CsvShape<SiteCrawlResult> = {
  id: "crawl_site",
  columns: [
    "url",
    "rowState",
    "status",
    "bytesRead",
    "title",
    "description",
    "canonical",
    "robots",
    "lang",
    "h1",
    "h2",
    "h3",
    "linkCount",
    "internalLinks",
    "externalLinks",
    "imageCount",
    "imagesMissingAlt",
    "openGraph",
    "jsonLd.blocks",
    "jsonLd.types",
    "jsonLd.invalid",
    "wordCount",
    "indexable",
    "issues",
    "fetchTimeMs",
    "error",
  ],
  rows(result) {
    return result.pages.map((page) => {
      if (page.result) {
        const r = page.result;
        return [
          cell(page.url),
          "analyzed",
          cell(r.status),
          cell(r.bytesRead),
          cell(r.title),
          cell(r.description),
          cell(r.canonical),
          cell(r.robots),
          cell(r.lang),
          cell(r.h1.join("; ")),
          cell(r.h2.join("; ")),
          cell(r.h3.join("; ")),
          cell(r.linkCount),
          cell(r.internalLinks),
          cell(r.externalLinks),
          cell(r.imageCount),
          cell(r.imagesMissingAlt),
          cell(r.openGraph),
          cell(r.jsonLd.blocks),
          cell(r.jsonLd.types.join("; ")),
          cell(r.jsonLd.invalid),
          cell(r.wordCount),
          cell(r.indexable),
          cell(r.issues),
          cell(r.fetchTimeMs),
          "", // error — empty, never a fabricated value, for an analyzed row
        ];
      }
      // Failed row: issue-derived columns stay empty, never "0" — a failed
      // page is not a zero-issue page.
      return [
        cell(page.url),
        "failed",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        cell(page.error),
      ];
    });
  },
  // Aggregate/nested top-level fields not represented as per-page columns.
  // `pages` itself is represented by the rows, not by a column.
  omitted: [
    "site",
    "sitemap",
    "sitemapFound",
    "crawlPolicy",
    "requested",
    "crawled",
    "failed",
    "documentsRead",
    "subrequests",
    "bytesRead",
    "outputBytes",
    "pages",
    "issueCounts",
    "summary",
    "linkGraph",
  ],
};

const checkLinksShape: CsvShape<LinkCheckResult> = {
  id: "check_links",
  columns: [
    "url",
    "pageStatus",
    "checked",
    "ok",
    "broken",
    "errors",
    "probeUrl",
    "probeState",
    "probeStatus",
    "probeRedirects",
    "probeError",
  ],
  rows(result) {
    if (result.results.length === 0) {
      return [
        [
          cell(result.url),
          cell(result.pageStatus),
          cell(result.checked),
          cell(result.ok),
          cell(result.broken),
          cell(result.errors),
          "",
          "",
          "",
          "",
          "",
        ],
      ];
    }
    return result.results.map((probe) => [
      cell(result.url),
      cell(result.pageStatus),
      cell(result.checked),
      cell(result.ok),
      cell(result.broken),
      cell(result.errors),
      cell(probe.url),
      cell(probe.state),
      cell(probe.status),
      cell(probe.redirects),
      cell(probe.error),
    ]);
  },
  // `results` itself is represented by the rows, not by a column.
  omitted: ["results"],
};

const analyzePagespeedShape: CsvShape<PageSpeedResult> = {
  id: "analyze_pagespeed",
  columns: [
    "url",
    "strategy",
    "fetchedAt",
    "performanceScore",
    "accessibilityScore",
    "bestPracticesScore",
    "seoScore",
    "labMetrics.firstContentfulPaintMs",
    "labMetrics.largestContentfulPaintMs",
    "labMetrics.totalBlockingTimeMs",
    "labMetrics.cumulativeLayoutShift",
    "labMetrics.speedIndexMs",
    "fieldMetrics.overallCategory",
    "fieldMetrics.interactionToNextPaintMs",
    "opportunityId",
    "opportunityTitle",
    "opportunitySavingsMs",
    "opportunitySavingsBytes",
  ],
  rows(result) {
    const base = [
      cell(result.url),
      cell(result.strategy),
      cell(result.fetchedAt),
      cell(result.performanceScore),
      cell(result.accessibilityScore),
      cell(result.bestPracticesScore),
      cell(result.seoScore),
      cell(result.labMetrics.firstContentfulPaintMs),
      cell(result.labMetrics.largestContentfulPaintMs),
      cell(result.labMetrics.totalBlockingTimeMs),
      cell(result.labMetrics.cumulativeLayoutShift),
      cell(result.labMetrics.speedIndexMs),
      cell(result.fieldMetrics?.overallCategory),
      cell(result.fieldMetrics?.interactionToNextPaintMs),
    ];
    if (result.opportunities.length === 0) {
      return [[...base, "", "", "", ""]];
    }
    return result.opportunities.map((opportunity) => [
      ...base,
      cell(opportunity.id),
      cell(opportunity.title),
      cell(opportunity.savingsMs),
      cell(opportunity.savingsBytes),
    ]);
  },
  // Represented via the derived opportunity* columns above, but the raw
  // field itself has no 1:1 column — explicitly noted rather than silently
  // dropped, per the "field with no defined column" scenario.
  omitted: ["opportunities"],
};

export const CSV_SHAPES = {
  crawl_page: crawlPageShape,
  crawl_site: crawlSiteShape,
  check_links: checkLinksShape,
  analyze_pagespeed: analyzePagespeedShape,
} as const;

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvLine(values: readonly string[]): string {
  return values.map(csvEscape).join(",");
}

export interface SerializeCsvOptions {
  readonly bounds?: readonly Bound[];
}

/**
 * Serializes a `CsvShape<T>` result to CSV text, deterministically: the
 * same input always yields the same column order and the same per-row
 * values (the `result-export` golden/stability requirement — nothing here
 * depends on object key iteration order, `Date.now()`, or randomness).
 * `omitted` is written as a leading comment row so an omission is
 * documented in the artifact itself, never a silent gap; `bounds` — when
 * non-empty — is written as one comment line per bound, and is entirely
 * absent (no comment lines at all) for a complete, unbounded result, so a
 * complete export is never mistaken for a truncated one.
 */
export function serializeCsv<T>(
  shape: CsvShape<T>,
  result: T,
  options: SerializeCsvOptions = {},
): string {
  const lines: string[] = [];
  if (shape.omitted.length > 0) {
    lines.push(`# omitted: ${shape.omitted.join(", ")}`);
  }
  for (const bound of options.bounds ?? []) {
    const totalPart = bound.total === undefined ? "" : ` total=${bound.total}`;
    lines.push(
      `# bound: ${bound.kind} ${bound.scope} shown=${bound.shown} limit=${bound.limitValue} (${bound.limitName})${totalPart}`,
    );
  }
  lines.push(csvLine(shape.columns));
  for (const row of shape.rows(result)) {
    lines.push(csvLine(row));
  }
  return lines.join("\n");
}
