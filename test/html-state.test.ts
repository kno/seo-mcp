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
        "h1",
        "imageCount",
        "imagesMissingAlt",
        "lang",
        "links",
        "robots",
        "title",
      ].sort(),
    );
  });
});
