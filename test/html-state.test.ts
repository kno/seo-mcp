import { describe, expect, it } from "vitest";
import { HtmlExtractionState } from "../src/seo/html";

const element = (attributes: Record<string, string>) => ({
  getAttribute: (name: string) => attributes[name] ?? null,
});

describe("HtmlExtractionState", () => {
  it("combines chunked text and collects bounded SEO signals", () => {
    const state = new HtmlExtractionState();
    state.onHtml(element({ lang: "en" }));
    state.appendTitle({ text: "SEO " });
    state.appendTitle({ text: "guide" });
    state.onMeta(element({ name: "description", content: "A useful guide" }));
    state.onCanonical(element({ href: "https://example.com/guide" }));
    state.beginH1();
    state.appendH1({ text: "Main " });
    state.appendH1({ text: "heading" });
    state.onLink(element({ href: "/about" }));
    state.onImage(element({ src: "/hero.png" }));

    expect(state.finish()).toMatchObject({
      title: "SEO guide",
      description: "A useful guide",
      lang: "en",
      h1: ["Main heading"],
      links: ["/about"],
      imageCount: 1,
      imagesMissingAlt: 1,
    });
  });

  it("bounds accumulated chunked text, headings, and links", () => {
    const state = new HtmlExtractionState();
    for (let index = 0; index < 20; index++) {
      state.beginH1();
      state.appendH1({ text: "x".repeat(500) });
    }
    for (let index = 0; index < 100; index++)
      state.onLink(element({ href: `/${"x".repeat(2_000)}${index}` }));
    state.appendTitle({ text: "t".repeat(1_000) });
    const result = state.finish();
    expect(result.title).toHaveLength(300);
    expect(result.h1).toHaveLength(10);
    expect(result.h1.every((heading) => heading.length <= 300)).toBe(true);
    expect(result.links).toHaveLength(50);
    expect(result.links.every((link) => link.length <= 1_024)).toBe(true);
  });

  it("serializes only public PageSignals fields", () => {
    const state = new HtmlExtractionState();
    state.onHtml(element({ lang: "en" }));
    state.onMeta(element({ name: "description", content: "Description" }));
    state.onMeta(element({ name: "robots", content: "index,follow" }));
    state.onCanonical(element({ href: "https://example.com/" }));
    state.appendTitle({ text: "Title" });
    state.beginH1();
    state.appendH1({ text: "Heading" });
    state.onLink(element({ href: "/about" }));
    state.onImage(element({ alt: "Logo" }));

    const serialized = JSON.parse(JSON.stringify(state.finish())) as Record<
      string,
      unknown
    >;
    expect(Object.keys(serialized).sort()).toEqual(
      [
        "canonical",
        "description",
        "externalLinks",
        "h1",
        "h2",
        "h3",
        "imageCount",
        "imagesMissingAlt",
        "indexable",
        "internalLinkTargets",
        "internalLinks",
        "jsonLd",
        "lang",
        "links",
        "openGraph",
        "robots",
        "title",
        "wordCount",
      ].sort(),
    );
  });

  it("captures, trims, and bounds h2 and h3 headings", () => {
    const state = new HtmlExtractionState();
    state.beginH2();
    state.appendH2({ text: "  Section  " });
    state.appendH2({ text: "one  " });
    state.beginH3();
    state.appendH3({ text: "Sub " });
    state.appendH3({ text: "topic" });
    for (let index = 0; index < 30; index++) {
      state.beginH2();
      state.appendH2({ text: "x".repeat(500) });
      state.beginH3();
      state.appendH3({ text: "y".repeat(500) });
    }
    const result = state.finish();
    expect(result.h2[0]).toBe("Section one");
    expect(result.h3[0]).toBe("Sub topic");
    expect(result.h2).toHaveLength(20);
    expect(result.h3).toHaveLength(20);
    expect(result.h2.every((value) => value.length <= 300)).toBe(true);
    expect(result.h3.every((value) => value.length <= 300)).toBe(true);
  });

  it("classifies links as internal or external against the base url", () => {
    const state = new HtmlExtractionState();
    state.onBaseUrl(new URL("https://example.com/blog/"));
    state.onLink(element({ href: "/about" }));
    state.onLink(element({ href: "post" }));
    state.onLink(element({ href: "https://EXAMPLE.com/contact" }));
    state.onLink(element({ href: "https://other.com/page" }));
    state.onLink(element({ href: "mailto:hi@example.com" }));
    state.onLink(element({ href: "tel:+123" }));
    state.onLink(element({ href: "javascript:void(0)" }));
    state.onLink(element({ href: "#section" }));

    const result = state.finish();
    expect(result.internalLinks).toBe(3);
    expect(result.externalLinks).toBe(1);
    expect(result.links).toEqual([
      "https://example.com/about",
      "https://example.com/blog/post",
      "https://example.com/contact",
      "https://other.com/page",
    ]);
  });

  it("falls back to raw hrefs when no base url is set", () => {
    const state = new HtmlExtractionState();
    state.onLink(element({ href: "/about" }));
    const result = state.finish();
    expect(result.links).toEqual(["/about"]);
    expect(result.internalLinks).toBe(0);
    expect(result.externalLinks).toBe(0);
    expect(result.internalLinkTargets).toEqual([]);
  });

  it("collects absolute internal link targets, strips fragments, dedupes", () => {
    const state = new HtmlExtractionState();
    state.onBaseUrl(new URL("https://example.com/blog/"));
    state.onLink(element({ href: "/about" }));
    state.onLink(element({ href: "post" }));
    state.onLink(element({ href: "/about#top" }));
    state.onLink(element({ href: "https://EXAMPLE.com/contact" }));
    state.onLink(element({ href: "https://other.com/page" }));
    state.onLink(element({ href: "mailto:hi@example.com" }));

    const result = state.finish();
    expect(result.internalLinkTargets).toEqual([
      "https://example.com/about",
      "https://example.com/blog/post",
      "https://example.com/contact",
    ]);
    expect(
      result.internalLinkTargets.every((target) =>
        target.startsWith("https://example.com/"),
      ),
    ).toBe(true);
  });

  it("bounds internal link targets at 100 entries", () => {
    const state = new HtmlExtractionState();
    state.onBaseUrl(new URL("https://example.com/"));
    for (let index = 0; index < 250; index++)
      state.onLink(element({ href: `/page-${index}` }));
    const result = state.finish();
    expect(result.internalLinkTargets).toHaveLength(100);
  });

  it("captures Open Graph properties and bounds them", () => {
    const state = new HtmlExtractionState();
    state.onMeta(element({ property: "og:title", content: "Hello" }));
    state.onMeta(element({ property: "og:type", content: "article" }));
    state.onMeta(element({ name: "description", content: "Desc" }));
    for (let index = 0; index < 40; index++)
      state.onMeta(element({ property: `og:extra${index}`, content: "v" }));
    const result = state.finish();
    expect(result.openGraph["og:title"]).toBe("Hello");
    expect(result.openGraph["og:type"]).toBe("article");
    expect(result.description).toBe("Desc");
    expect(Object.keys(result.openGraph).length).toBeLessThanOrEqual(25);
  });

  it("collects JSON-LD @type values including arrays and node lists", () => {
    const state = new HtmlExtractionState();
    state.beginJsonLd();
    state.appendJsonLd({ text: '{"@type":"Article"}' });
    state.beginJsonLd();
    state.appendJsonLd({ text: '{"@type":["WebPage","Thing"]}' });
    state.beginJsonLd();
    state.appendJsonLd({
      text: '[{"@type":"Person"},{"@type":"Organization"}]',
    });
    const result = state.finish();
    expect(result.jsonLd.blocks).toBe(3);
    expect(result.jsonLd.invalid).toBe(0);
    expect(result.jsonLd.types.sort()).toEqual(
      ["Article", "WebPage", "Thing", "Person", "Organization"].sort(),
    );
  });

  it("flags malformed JSON-LD blocks as invalid", () => {
    const state = new HtmlExtractionState();
    state.beginJsonLd();
    state.appendJsonLd({ text: "{not valid json" });
    const result = state.finish();
    expect(result.jsonLd.blocks).toBe(1);
    expect(result.jsonLd.invalid).toBe(1);
    expect(result.jsonLd.types).toEqual([]);
  });

  it("counts visible words but excludes suppressed regions", () => {
    const state = new HtmlExtractionState();
    state.appendBodyText({ text: "one two three" });
    state.enterSuppressed();
    state.appendBodyText({ text: "script text should not count here" });
    state.exitSuppressed();
    state.appendBodyText({ text: "four five" });
    const result = state.finish();
    expect(result.wordCount).toBe(5);
  });

  it("derives indexable from robots directives", () => {
    const allowed = new HtmlExtractionState();
    allowed.onMeta(element({ name: "robots", content: "index,follow" }));
    expect(allowed.robotsAllowsIndexing()).toBe(true);

    const blocked = new HtmlExtractionState();
    blocked.onMeta(element({ name: "robots", content: "noindex,follow" }));
    expect(blocked.robotsAllowsIndexing()).toBe(false);

    const none = new HtmlExtractionState();
    none.onMeta(element({ name: "robots", content: "none" }));
    expect(none.robotsAllowsIndexing()).toBe(false);
  });
});
