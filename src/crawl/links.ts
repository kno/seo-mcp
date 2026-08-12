import type * as z from "zod/v4";
import { LIMITS } from "../config";
import { createFetchBudget } from "../http/fetch";
import { normalizePublicUrl, resolvePublicUrl } from "../security/url-policy";
import { crawlPage } from "./page";
import { mapConcurrent } from "./site";
import { linkCheckResultSchema, linkProbeSchema } from "../schemas/links";

export type LinkProbe = z.infer<typeof linkProbeSchema>;
export type LinkCheckResult = z.infer<typeof linkCheckResultSchema>;

const PROBE_ACCEPT = "text/html,application/xhtml+xml;q=0.9";
const PROBE_USER_AGENT = "seo-mcp/0.1 (+https://github.com/kno/seo-mcp)";

export async function probeLink(
  rawUrl: string,
  fetcher: typeof fetch,
): Promise<LinkProbe> {
  let url: URL;
  try {
    url = normalizePublicUrl(rawUrl);
  } catch (error) {
    return {
      url: rawUrl,
      state: "error",
      error: error instanceof Error ? error.message : "Invalid URL",
    };
  }

  const startUrl = url.toString();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("Link probe timed out"),
    LIMITS.linkProbeTimeoutMs,
  );

  try {
    let current = url;
    for (let redirects = 0; redirects <= LIMITS.maxRedirects; redirects++) {
      const response = await fetcher(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: PROBE_ACCEPT,
          "user-agent": PROBE_USER_AGENT,
        },
      });
      await response.body?.cancel();

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location)
          throw new Error("Redirect response is missing a Location header");
        if (redirects === LIMITS.maxRedirects)
          throw new Error("Too many redirects");
        current = resolvePublicUrl(location, current);
        continue;
      }

      return {
        url: startUrl,
        state: response.status >= 400 ? "broken" : "ok",
        status: response.status,
        redirects,
      };
    }
    throw new Error("Too many redirects");
  } catch (error) {
    if (controller.signal.aborted)
      return { url: startUrl, state: "error", error: "Link probe timed out" };
    return {
      url: startUrl,
      state: "error",
      error: error instanceof Error ? error.message : "Link probe failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkLinks(
  pageUrl: string,
  fetcher?: typeof fetch,
): Promise<LinkCheckResult> {
  const budget = createFetchBudget(fetcher, LIMITS.linkCheckSubrequestBudget);
  const page = await crawlPage(pageUrl, budget.fetcher);

  const seen = new Set<string>();
  const targets: string[] = [];
  for (const link of page.links) {
    if (seen.has(link)) continue;
    seen.add(link);
    targets.push(link);
    if (targets.length >= LIMITS.maxLinkChecks) break;
  }

  const results = await mapConcurrent(
    targets,
    LIMITS.linkCheckConcurrency,
    async (link) => {
      try {
        return await probeLink(link, budget.fetcher);
      } catch (error) {
        return {
          url: link,
          state: "error",
          error: error instanceof Error ? error.message : "Link probe failed",
        } satisfies LinkProbe;
      }
    },
  );

  let ok = 0;
  let broken = 0;
  let errors = 0;
  for (const probe of results) {
    if (probe.state === "ok") ok++;
    else if (probe.state === "broken") broken++;
    else errors++;
  }

  return {
    url: page.url,
    pageStatus: page.status,
    checked: results.length,
    ok,
    broken,
    errors,
    results,
  };
}
