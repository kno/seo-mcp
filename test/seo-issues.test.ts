import { describe, expect, it } from "vitest";
import { detectSeoIssues, type PageSignals } from "../src/seo/analyze";

const page = (overrides: Partial<PageSignals> = {}): PageSignals => ({
  title: "",
  description: "",
  h1: [],
  h2: [],
  h3: [],
  links: [],
  internalLinkTargets: [],
  internalLinks: 0,
  externalLinks: 0,
  imageCount: 0,
  imagesMissingAlt: 0,
  openGraph: {},
  jsonLd: { blocks: 0, types: [], invalid: 0 },
  wordCount: 0,
  indexable: true,
  ...overrides,
});

describe("detectSeoIssues", () => {
  it("reports actionable omissions", () => {
    const signals = page({
      imageCount: 2,
      imagesMissingAlt: 1,
    });
    expect(detectSeoIssues(signals).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "missing_title",
        "missing_description",
        "missing_h1",
        "images_missing_alt",
      ]),
    );
  });

  it("returns no issues for a complete page", () => {
    const signals = page({
      title: "A focused and descriptive page title",
      description: "A concise description.",
      canonical: "https://example.com",
      lang: "en",
      h1: ["Main heading"],
      imageCount: 1,
      openGraph: { "og:title": "Title" },
      wordCount: 500,
    });
    expect(detectSeoIssues(signals)).toEqual([]);
  });

  it("flags noindex pages", () => {
    const signals = page({
      title: "A focused and descriptive page title",
      description: "A concise description.",
      canonical: "https://example.com",
      lang: "en",
      h1: ["Main heading"],
      openGraph: { "og:title": "Title" },
      wordCount: 500,
      robots: "noindex,follow",
      indexable: false,
    });
    expect(detectSeoIssues(signals).map((issue) => issue.code)).toContain(
      "noindex",
    );
  });

  it("flags invalid JSON-LD", () => {
    const signals = page({
      jsonLd: { blocks: 1, types: [], invalid: 1 },
    });
    expect(detectSeoIssues(signals).map((issue) => issue.code)).toContain(
      "invalid_jsonld",
    );
  });

  it("flags missing Open Graph metadata", () => {
    const signals = page({ openGraph: {} });
    expect(detectSeoIssues(signals).map((issue) => issue.code)).toContain(
      "missing_open_graph",
    );
  });

  it("flags thin content", () => {
    const thin = page({ wordCount: 100 });
    expect(detectSeoIssues(thin).map((issue) => issue.code)).toContain(
      "thin_content",
    );
    const empty = page({ wordCount: 0 });
    expect(detectSeoIssues(empty).map((issue) => issue.code)).not.toContain(
      "thin_content",
    );
  });
});
