import { describe, expect, it } from "vitest";
import { pageAnalysisSchema } from "../../src/schemas/page";

function fullFixture() {
  return {
    url: "https://example.com/",
    status: 200,
    bytesRead: 1024,
    title: "Example",
    description: "An example page",
    canonical: "https://example.com/",
    robots: "index,follow",
    lang: "en",
    h1: ["Example"],
    h2: [],
    h3: [],
    links: ["https://example.com/about"],
    internalLinkTargets: ["https://example.com/about"],
    internalLinks: 1,
    externalLinks: 0,
    imageCount: 2,
    imagesMissingAlt: 0,
    openGraph: { "og:title": "Example" },
    jsonLd: { blocks: 0, types: [], invalid: 0 },
    wordCount: 300,
    indexable: true,
    issues: [{ code: "missing_lang", severity: "info", message: "..." }],
    fetchTimeMs: 120,
  };
}

describe("pageAnalysisSchema", () => {
  it("accepts a fixture with every field populated", () => {
    const fixture = fullFixture();
    expect(pageAnalysisSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a fixture omitting all optional fields", () => {
    const fixture = fullFixture();
    delete (fixture as Record<string, unknown>).canonical;
    delete (fixture as Record<string, unknown>).robots;
    delete (fixture as Record<string, unknown>).lang;
    delete (fixture as Record<string, unknown>).fetchTimeMs;
    const parsed = pageAnalysisSchema.parse(fixture);
    expect(parsed.canonical).toBeUndefined();
    expect(parsed.fetchTimeMs).toBeUndefined();
  });

  it("rejects a fixture missing a required field", () => {
    const fixture = fullFixture() as Record<string, unknown>;
    delete fixture.wordCount;
    expect(() => pageAnalysisSchema.parse(fixture)).toThrow();
  });
});
