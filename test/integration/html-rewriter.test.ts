import { describe, expect, it, vi } from "vitest";
import { crawlPage } from "../../src/crawl/page";
import { extractHtml } from "../../src/seo/html";

const encoder = new TextEncoder();

function bytes(html: string): Uint8Array {
  return encoder.encode(html);
}

const BASE_URL = new URL("https://example.com/page");

const RICH_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Real HTMLRewriter Integration Test Page</title>
    <meta name="description" content="A representative page for exercising the real HTMLRewriter wiring." />
    <meta property="og:title" content="OG Title Value" />
    <meta property="og:image" content="https://example.com/og.png" />
    <link rel="canonical" href="https://example.com/page" />
    <script type="application/ld+json">
      { "@context": "https://schema.org", "@type": "Article", "headline": "Valid Block" }
    </script>
    <script type="application/ld+json">
      { "@type": "BrokenBlock", broken json here
    </script>
  </head>
  <body>
    <h1>Primary Heading One</h1>
    <h2>Section Alpha</h2>
    <h2>Section Beta</h2>
    <h3>Subsection Gamma</h3>
    <p>
      alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega
    </p>
    <a href="/internal-relative">Internal relative link</a>
    <a href="https://other-host.example.org/page">External absolute link</a>
    <a href="mailto:hello@example.com">Email link</a>
    <img src="/pic.png" alt="described" />
    <script>
      // ZZUNIQUESCRIPTWORDA ZZUNIQUESCRIPTWORDB ZZUNIQUESCRIPTWORDC
      const secret = "ZZUNIQUESCRIPTWORDD";
    </script>
    <style>
      /* ZZUNIQUESTYLEWORDA ZZUNIQUESTYLEWORDB */
      body { color: red; }
    </style>
  </body>
</html>`;

describe("extractHtml (real HTMLRewriter)", () => {
  it("captures headings, links, open graph, json-ld and body word count", async () => {
    const result = await extractHtml(bytes(RICH_HTML), BASE_URL, 200);

    // Title + single H1
    expect(result.title).toBe("Real HTMLRewriter Integration Test Page");
    expect(result.h1).toEqual(["Primary Heading One"]);

    // Multiple H2 and an H3
    expect(result.h2).toEqual(["Section Alpha", "Section Beta"]);
    expect(result.h3).toEqual(["Subsection Gamma"]);

    // Internal (relative) vs external (absolute other host); mailto skipped
    expect(result.internalLinks).toBe(1);
    expect(result.externalLinks).toBe(1);
    expect(
      result.links.some((l) => l.toLowerCase().startsWith("mailto:")),
    ).toBe(false);

    // Internal link targets: relative internal link resolved to absolute,
    // external host excluded.
    expect(result.internalLinkTargets).toEqual([
      "https://example.com/internal-relative",
    ]);

    // Open Graph
    expect(result.openGraph["og:title"]).toBe("OG Title Value");
    expect(result.openGraph["og:image"]).toBe("https://example.com/og.png");

    // JSON-LD: one valid block with its @type, one malformed → invalid + issue
    expect(result.jsonLd.blocks).toBeGreaterThanOrEqual(1);
    expect(result.jsonLd.types).toContain("Article");
    expect(result.jsonLd.invalid).toBeGreaterThanOrEqual(1);
    expect(result.issues.some((i) => i.code === "invalid_jsonld")).toBe(true);

    // Word count excludes <script>/<style> content, includes visible body text
    expect(result.wordCount).toBeGreaterThan(0);
    // Visible words are counted (the greek paragraph has 24 words)
    expect(result.wordCount).toBeGreaterThanOrEqual(24);
    // No script/style leakage: bound word count well below what it would be
    // if script/style tokens were counted. Confirm the values are not present
    // by comparing against a script-only fixture below as well.
  });

  it("excludes <script>/<style> text from wordCount", async () => {
    const withScript = `<!doctype html>
<html lang="en"><head><title>Word Count Isolation</title></head>
<body>
  <p>visibleone visibletwo visiblethree</p>
  <script>scriptwordone scriptwordtwo scriptwordthree scriptwordfour scriptwordfive scriptwordsix scriptwordseven scriptwordeight</script>
  <style>stylewordone stylewordtwo stylewordthree stylewordfour</style>
  <noscript>noscriptone noscripttwo</noscript>
</body></html>`;
    const result = await extractHtml(bytes(withScript), BASE_URL, 200);
    // Only the 3 visible words should be counted, none of the script/style words.
    expect(result.wordCount).toBe(3);
  });

  it("marks noindex robots pages as not indexable with a noindex issue", async () => {
    const noindex = `<!doctype html>
<html lang="en"><head>
  <title>Noindex Robots Page Example</title>
  <meta name="description" content="This page is marked noindex via robots meta." />
  <meta name="robots" content="noindex" />
</head><body><h1>Blocked</h1><p>one two three four five</p></body></html>`;
    const result = await extractHtml(bytes(noindex), BASE_URL, 200);
    expect(result.indexable).toBe(false);
    expect(result.issues.some((i) => i.code === "noindex")).toBe(true);
  });

  it("marks a normal status-200 page as indexable", async () => {
    const normal = `<!doctype html>
<html lang="en"><head>
  <title>Normal Indexable Page Example</title>
  <meta name="description" content="A normal indexable page without robots noindex." />
</head><body><h1>Welcome</h1><p>one two three four five</p></body></html>`;
    const result = await extractHtml(bytes(normal), BASE_URL, 200);
    expect(result.indexable).toBe(true);
    expect(result.issues.some((i) => i.code === "noindex")).toBe(false);
  });
});

describe("crawlPage (real HTMLRewriter)", () => {
  it("propagates fetchTimeMs as a non-negative number", async () => {
    const minimalHtml = `<!doctype html>
<html lang="en"><head>
  <title>Timing Test Page</title>
  <meta name="description" content="Testing fetchTimeMs propagation." />
</head><body><h1>Timing</h1><p>one two three</p></body></html>`;
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(minimalHtml, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    );
    const result = await crawlPage("https://example.com/timing", fetcher);
    expect(typeof result.fetchTimeMs).toBe("number");
    expect(result.fetchTimeMs).toBeGreaterThanOrEqual(0);
  });
});
