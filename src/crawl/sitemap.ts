import { LIMITS } from "../config";
import { fetchBounded, type ResponseByteBudget } from "../http/fetch";
import { normalizePublicUrl, sameOrigin } from "../security/url-policy";

export interface SitemapDocument {
  kind: "urlset" | "index";
  locations: string[];
}

export interface SitemapDiscovery {
  sitemap: string;
  sitemapFound: boolean;
  urls: string[];
  documentsRead: number;
}

class SitemapHttpError extends Error {
  constructor(readonly status: number) {
    super(`Sitemap returned HTTP ${status}`);
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function parseSitemap(
  xml: string,
  maximum = LIMITS.maxSitemapLocations,
): SitemapDocument {
  const prefix = xml.slice(0, 2_000).toLowerCase();
  const kind = prefix.includes("<sitemapindex")
    ? "index"
    : prefix.includes("<urlset")
      ? "urlset"
      : undefined;
  if (!kind)
    throw new Error("Document is not a sitemap urlset or sitemap index");
  const locations: string[] = [];
  const pattern = /<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc>/gi;
  for (
    let match = pattern.exec(xml);
    match && locations.length < maximum;
    match = pattern.exec(xml)
  ) {
    const location = decodeXml(match[1].trim()).slice(0, 4_096);
    if (location) locations.push(location);
  }
  return { kind, locations };
}

async function loadSitemap(
  url: URL,
  fetcher?: typeof fetch,
  byteBudget?: ResponseByteBudget,
): Promise<SitemapDocument> {
  const response = await fetchBounded(url, {
    maxBytes: LIMITS.maxSitemapBytes,
    accept: "application/xml,text/xml;q=0.9,*/*;q=0.1",
    fetcher,
    byteBudget,
  });
  if (!response.status.toString().startsWith("2"))
    throw new SitemapHttpError(response.status);
  return parseSitemap(new TextDecoder().decode(response.bytes));
}

export async function discoverSitemapUrls(
  siteUrl: string,
  limit: number,
  fetcher?: typeof fetch,
  byteBudget?: ResponseByteBudget,
): Promise<SitemapDiscovery> {
  const site = normalizePublicUrl(siteUrl);
  const sitemap = new URL("/sitemap.xml", site);
  let root: SitemapDocument;
  try {
    root = await loadSitemap(sitemap, fetcher, byteBudget);
  } catch (error) {
    if (error instanceof SitemapHttpError && error.status === 404) {
      return {
        sitemap: sitemap.toString(),
        sitemapFound: false,
        urls: [site.toString()],
        documentsRead: 0,
      };
    }
    throw error;
  }
  let documentsRead = 1;
  let locations = root.locations;

  if (root.kind === "index") {
    const children: URL[] = [];
    for (const location of root.locations) {
      try {
        const child = normalizePublicUrl(location);
        if (sameOrigin(child, site)) children.push(child);
      } catch {
        continue;
      }
      if (children.length >= LIMITS.maxSitemapDocuments - 1) break;
    }
    locations = [];
    for (const child of children) {
      try {
        const document = await loadSitemap(child, fetcher, byteBudget);
        documentsRead++;
        if (document.kind !== "urlset") continue;
        locations.push(...document.locations);
        if (locations.length >= limit) break;
      } catch {
        continue;
      }
    }
  }

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const location of locations) {
    let url: URL;
    try {
      url = normalizePublicUrl(location);
    } catch {
      continue;
    }
    if (!sameOrigin(url, site) || seen.has(url.toString())) continue;
    seen.add(url.toString());
    urls.push(url.toString());
    if (urls.length >= limit) break;
  }
  return {
    sitemap: sitemap.toString(),
    sitemapFound: true,
    urls,
    documentsRead,
  };
}
