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
  links: string[] = [];
  imageCount = 0;
  imagesMissingAlt = 0;
  private currentH1 = -1;

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
  }

  onCanonical(element: ElementLike): void {
    this.canonical ||=
      element.getAttribute("href")?.trim().slice(0, 2_048) || undefined;
  }

  onLink(element: ElementLike): void {
    const href = element.getAttribute("href")?.trim().slice(0, 1_024);
    if (href && this.links.length < 50) this.links.push(href);
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

  appendTitle(chunk: TextChunkLike): void {
    if (this.title.length < 300)
      this.title = (this.title + chunk.text).slice(0, 300);
  }

  finish(): PageSignals {
    this.title = this.title.replace(/\s+/g, " ").trim();
    this.h1 = this.h1
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return {
      title: this.title,
      description: this.description,
      canonical: this.canonical,
      robots: this.robots,
      lang: this.lang,
      h1: [...this.h1],
      links: [...this.links],
      imageCount: this.imageCount,
      imagesMissingAlt: this.imagesMissingAlt,
    };
  }
}

export interface PageAnalysis extends PageSignals {
  url: string;
  status: number;
  bytesRead: number;
  issues: ReturnType<typeof detectSeoIssues>;
}

export async function extractHtml(
  bytes: Uint8Array,
  url: URL,
  status: number,
): Promise<PageAnalysis> {
  const state = new HtmlExtractionState();
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  const html = new Response(body.buffer, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
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
    .on("a[href]", { element: (element) => state.onLink(element) })
    .on("img", { element: (element) => state.onImage(element) })
    .transform(html);

  await transformed.arrayBuffer();
  const signals = state.finish();
  return {
    url: url.toString(),
    status,
    bytesRead: bytes.byteLength,
    ...signals,
    issues: detectSeoIssues(signals),
  };
}
