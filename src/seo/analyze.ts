export interface PageSignals {
  title: string;
  description: string;
  canonical?: string;
  robots?: string;
  lang?: string;
  h1: string[];
  h2: string[];
  h3: string[];
  links: string[];
  internalLinkTargets: string[];
  internalLinks: number;
  externalLinks: number;
  imageCount: number;
  imagesMissingAlt: number;
  openGraph: Record<string, string>;
  jsonLd: { blocks: number; types: string[]; invalid: number };
  wordCount: number;
  indexable: boolean;
}

export interface SeoIssue {
  code: string;
  severity: "warning" | "info";
  message: string;
}

export function detectSeoIssues(page: PageSignals): SeoIssue[] {
  const issues: SeoIssue[] = [];
  if (!page.title)
    issues.push({
      code: "missing_title",
      severity: "warning",
      message: "Page has no title",
    });
  else if (page.title.length < 15 || page.title.length > 60) {
    issues.push({
      code: "title_length",
      severity: "info",
      message: "Title should usually be 15–60 characters",
    });
  }
  if (!page.description) {
    issues.push({
      code: "missing_description",
      severity: "warning",
      message: "Page has no meta description",
    });
  } else if (page.description.length > 160) {
    issues.push({
      code: "description_length",
      severity: "info",
      message: "Meta description is longer than 160 characters",
    });
  }
  if (page.h1.length === 0)
    issues.push({
      code: "missing_h1",
      severity: "warning",
      message: "Page has no H1",
    });
  if (page.h1.length > 1)
    issues.push({
      code: "multiple_h1",
      severity: "info",
      message: "Page has multiple H1 headings",
    });
  if (!page.canonical)
    issues.push({
      code: "missing_canonical",
      severity: "info",
      message: "Page has no canonical link",
    });
  if (!page.lang)
    issues.push({
      code: "missing_lang",
      severity: "info",
      message: "HTML element has no lang attribute",
    });
  if (page.imagesMissingAlt > 0) {
    issues.push({
      code: "images_missing_alt",
      severity: "warning",
      message: `${page.imagesMissingAlt} image(s) are missing alt text`,
    });
  }
  if (!page.indexable && /\b(noindex|none)\b/i.test(page.robots ?? "")) {
    issues.push({
      code: "noindex",
      severity: "warning",
      message: "Page is marked noindex",
    });
  }
  if (page.jsonLd.invalid > 0) {
    issues.push({
      code: "invalid_jsonld",
      severity: "warning",
      message: `${page.jsonLd.invalid} JSON-LD block(s) failed to parse`,
    });
  }
  if (Object.keys(page.openGraph).length === 0) {
    issues.push({
      code: "missing_open_graph",
      severity: "info",
      message: "Page has no Open Graph metadata",
    });
  }
  if (page.wordCount > 0 && page.wordCount < 250) {
    issues.push({
      code: "thin_content",
      severity: "info",
      message: "Page has thin content (fewer than 250 words)",
    });
  }
  return issues;
}
