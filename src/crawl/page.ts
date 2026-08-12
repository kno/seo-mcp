import { LIMITS } from "../config";
import { fetchBounded, type ResponseByteBudget } from "../http/fetch";
import { extractHtml, type PageAnalysis } from "../seo/html";

export async function crawlPage(
  url: string,
  fetcher?: typeof fetch,
  byteBudget?: ResponseByteBudget,
): Promise<PageAnalysis> {
  const response = await fetchBounded(url, {
    maxBytes: LIMITS.maxHtmlBytes,
    accept: "text/html,application/xhtml+xml;q=0.9",
    fetcher,
    byteBudget,
  });
  if (!response.contentType.toLowerCase().includes("text/html")) {
    throw new Error(
      `Expected HTML but received ${response.contentType || "an unknown content type"}`,
    );
  }
  const analysis = await extractHtml(
    response.bytes,
    response.url,
    response.status,
  );
  return { ...analysis, fetchTimeMs: response.elapsedMs };
}
