import { detectSeoIssues, type PageSignals } from "./analyze";

type ElementLike = { getAttribute(name: string): string | null };
type TextChunkLike = { text: string };

export class HtmlExtractionState implements PageSignals {
  title = "";
  description = "";
  canonical?: string;
  robots?: string;
  lang?: string;
  h1: string[] = [];
  h2: string[] = [];
  h3: string[] = [];
  links: string[] = [];
  internalLinkTargets: string[] = [];
  internalLinks = 0;
  externalLinks = 0;
  imageCount = 0;
  imagesMissingAlt = 0;
  openGraph: Record<string, string> = {};
  jsonLd = { blocks: 0, types: [] as string[], invalid: 0 };
  wordCount = 0;
  indexable = true;
  private currentH1 = -1;
  private currentH2 = -1;
  private currentH3 = -1;
  private baseUrl?: URL;
  private jsonLdBlocks: string[] = [];
  private currentJsonLd = -1;
  private suppressDepth = 0;
  private internalTargetSet = new Set<string>();

  onBaseUrl(url: URL): void {
    this.baseUrl = url;
  }

  onHtml(element: ElementLike): void {
    this.lang = element.getAttribute("lang")?.trim().slice(0, 64) || undefined;
  }

  onMeta(element: ElementLike): void {
    const name = element.getAttribute("name")?.toLowerCase();
    const content = (element.getAttribute("content")?.trim() ?? "").slice(
      0,
      500,
    );
    if (name === "description" && !this.description) this.description = content;
    if (name === "robots" && !this.robots) this.robots = content;
    const property = element.getAttribute("property")?.trim().toLowerCase();
    if (
      property &&
      property.startsWith("og:") &&
      Object.keys(this.openGraph).length < 25 &&
      !(property in this.openGraph)
    ) {
      this.openGraph[property] = content;
    }
  }

  onCanonical(element: ElementLike): void {
    this.canonical ||=
      element.getAttribute("href")?.trim().slice(0, 2_048) || undefined;
  }

  onLink(element: ElementLike): void {
    const raw = element.getAttribute("href")?.trim();
    if (!raw) return;
    const lower = raw.toLowerCase();
    if (
      lower.startsWith("mailto:") ||
      lower.startsWith("tel:") ||
      lower.startsWith("javascript:") ||
      raw.startsWith("#")
    ) {
      return;
    }
    if (!this.baseUrl) {
      if (this.links.length < 50) this.links.push(raw.slice(0, 1_024));
      return;
    }
    let resolved: URL;
    try {
      resolved = new URL(raw, this.baseUrl);
    } catch {
      if (this.links.length < 50) this.links.push(raw.slice(0, 1_024));
      return;
    }
    if (resolved.protocol === "http:" || resolved.protocol === "https:") {
      if (
        resolved.hostname.toLowerCase() === this.baseUrl.hostname.toLowerCase()
      ) {
        this.internalLinks++;
        const target = new URL(resolved.toString());
        target.hash = "";
        const key = target.toString();
        if (
          this.internalTargetSet.size < 100 &&
          !this.internalTargetSet.has(key)
        ) {
          this.internalTargetSet.add(key);
          this.internalLinkTargets.push(key);
        }
      } else this.externalLinks++;
    }
    if (this.links.length < 50)
      this.links.push(resolved.toString().slice(0, 1_024));
  }

  onImage(element: ElementLike): void {
    this.imageCount++;
    const alt = element.getAttribute("alt");
    if (alt === null || !alt.trim()) this.imagesMissingAlt++;
  }

  beginH1(): void {
    if (this.h1.length >= 10) {
      this.currentH1 = -1;
      return;
    }
    this.h1.push("");
    this.currentH1 = this.h1.length - 1;
  }

  appendH1(chunk: TextChunkLike): void {
    if (this.currentH1 >= 0 && this.h1[this.currentH1].length < 300) {
      this.h1[this.currentH1] = (this.h1[this.currentH1] + chunk.text).slice(
        0,
        300,
      );
    }
  }

  beginH2(): void {
    if (this.h2.length >= 20) {
      this.currentH2 = -1;
      return;
    }
    this.h2.push("");
    this.currentH2 = this.h2.length - 1;
  }

  appendH2(chunk: TextChunkLike): void {
    if (this.currentH2 >= 0 && this.h2[this.currentH2].length < 300) {
      this.h2[this.currentH2] = (this.h2[this.currentH2] + chunk.text).slice(
        0,
        300,
      );
    }
  }

  beginH3(): void {
    if (this.h3.length >= 20) {
      this.currentH3 = -1;
      return;
    }
    this.h3.push("");
    this.currentH3 = this.h3.length - 1;
  }

  appendH3(chunk: TextChunkLike): void {
    if (this.currentH3 >= 0 && this.h3[this.currentH3].length < 300) {
      this.h3[this.currentH3] = (this.h3[this.currentH3] + chunk.text).slice(
        0,
        300,
      );
    }
  }

  appendTitle(chunk: TextChunkLike): void {
    if (this.title.length < 300)
      this.title = (this.title + chunk.text).slice(0, 300);
  }

  beginJsonLd(): void {
    if (this.jsonLdBlocks.length >= 10) {
      this.currentJsonLd = -1;
      return;
    }
    this.jsonLdBlocks.push("");
    this.currentJsonLd = this.jsonLdBlocks.length - 1;
  }

  appendJsonLd(chunk: TextChunkLike): void {
    if (
      this.currentJsonLd >= 0 &&
      this.jsonLdBlocks[this.currentJsonLd].length < 32_000
    ) {
      this.jsonLdBlocks[this.currentJsonLd] = (
        this.jsonLdBlocks[this.currentJsonLd] + chunk.text
      ).slice(0, 32_000);
    }
  }

  enterSuppressed(): void {
    this.suppressDepth++;
  }

  exitSuppressed(): void {
    if (this.suppressDepth > 0) this.suppressDepth--;
  }

  appendBodyText(chunk: TextChunkLike): void {
    if (this.suppressDepth > 0 || this.wordCount >= 50_000) return;
    const words = chunk.text.split(/\s+/).filter(Boolean).length;
    this.wordCount = Math.min(50_000, this.wordCount + words);
  }

  robotsAllowsIndexing(): boolean {
    return !/\b(noindex|none)\b/i.test(this.robots ?? "");
  }

  private collectJsonLdTypes(): void {
    const types = new Set<string>();
    const addType = (value: unknown): void => {
      if (typeof value === "string") types.add(value.slice(0, 128));
      else if (Array.isArray(value))
        for (const entry of value)
          if (typeof entry === "string") types.add(entry.slice(0, 128));
    };
    for (const block of this.jsonLdBlocks) {
      const text = block.trim();
      if (!text) continue;
      this.jsonLd.blocks++;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        this.jsonLd.invalid++;
        continue;
      }
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (node && typeof node === "object")
          addType((node as Record<string, unknown>)["@type"]);
      }
    }
    this.jsonLd.types = [...types].slice(0, 25);
  }

  finish(): PageSignals {
    this.title = this.title.replace(/\s+/g, " ").trim();
    this.h1 = this.h1
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    this.h2 = this.h2
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    this.h3 = this.h3
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    this.collectJsonLdTypes();
    this.indexable = this.robotsAllowsIndexing();
    return {
      title: this.title,
      description: this.description,
      canonical: this.canonical,
      robots: this.robots,
      lang: this.lang,
      h1: [...this.h1],
      h2: [...this.h2],
      h3: [...this.h3],
      links: [...this.links],
      internalLinkTargets: [...this.internalLinkTargets],
      internalLinks: this.internalLinks,
      externalLinks: this.externalLinks,
      imageCount: this.imageCount,
      imagesMissingAlt: this.imagesMissingAlt,
      openGraph: { ...this.openGraph },
      jsonLd: {
        blocks: this.jsonLd.blocks,
        types: [...this.jsonLd.types],
        invalid: this.jsonLd.invalid,
      },
      wordCount: this.wordCount,
      indexable: this.indexable,
    };
  }
}

export interface PageAnalysis extends PageSignals {
  url: string;
  status: number;
  bytesRead: number;
  issues: ReturnType<typeof detectSeoIssues>;
  fetchTimeMs?: number;
}

export async function extractHtml(
  bytes: Uint8Array,
  url: URL,
  status: number,
): Promise<PageAnalysis> {
  const state = new HtmlExtractionState();
  state.onBaseUrl(url);
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  const html = new Response(body.buffer, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const suppress = {
    element(element: { onEndTag(handler: () => void): void }): void {
      state.enterSuppressed();
      element.onEndTag(() => state.exitSuppressed());
    },
  };
  const transformed = new HTMLRewriter()
    .on("html", { element: (element) => state.onHtml(element) })
    .on("title", { text: (text) => state.appendTitle(text) })
    .on("meta", { element: (element) => state.onMeta(element) })
    .on('link[rel~="canonical"]', {
      element: (element) => state.onCanonical(element),
    })
    .on("h1", {
      element: () => state.beginH1(),
      text: (text) => state.appendH1(text),
    })
    .on("h2", {
      element: () => state.beginH2(),
      text: (text) => state.appendH2(text),
    })
    .on("h3", {
      element: () => state.beginH3(),
      text: (text) => state.appendH3(text),
    })
    .on("a[href]", { element: (element) => state.onLink(element) })
    .on("img", { element: (element) => state.onImage(element) })
    .on('script[type="application/ld+json"]', {
      element: () => state.beginJsonLd(),
      text: (text) => state.appendJsonLd(text),
    })
    .on("script", suppress)
    .on("style", suppress)
    .on("noscript", suppress)
    .on("template", suppress)
    .on("body", { text: (text) => state.appendBodyText(text) })
    .transform(html);

  await transformed.arrayBuffer();
  const signals = state.finish();
  signals.indexable = signals.indexable && status === 200;
  return {
    url: url.toString(),
    status,
    bytesRead: bytes.byteLength,
    ...signals,
    issues: detectSeoIssues(signals),
  };
}
