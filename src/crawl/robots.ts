import { LIMITS } from "../config";
import { fetchBounded, type ResponseByteBudget } from "../http/fetch";
import { normalizePublicUrl } from "../security/url-policy";

// The crawler User-Agent is `seo-mcp/0.1 (...)`, so its robots product token
// is `seo-mcp`.
export const ROBOTS_USER_AGENT = "seo-mcp";

const MAX_LINES = 1_000;
const MAX_RULES = 500;
const MAX_SITEMAPS = 20;

export interface RobotsGroup {
  agents: string[];
  rules: Array<{ type: "allow" | "disallow"; path: string }>;
}

export interface RobotsRules {
  groups: RobotsGroup[];
  sitemaps: string[];
}

function emptyRules(): RobotsRules {
  return { groups: [], sitemaps: [] };
}

export function parseRobots(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  const seenSitemaps = new Set<string>();
  let current: RobotsGroup | undefined;
  // Whether the previous meaningful directive started/continued a run of
  // consecutive User-agent lines (which extend the same group).
  let collectingAgents = false;
  let ruleCount = 0;

  const lines = text.split(/\r?\n/, MAX_LINES);
  for (const rawLine of lines) {
    const withoutComment = rawLine.split("#", 1)[0];
    const line = withoutComment.trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "user-agent") {
      if (!collectingAgents || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
        collectingAgents = true;
      }
      if (value) current.agents.push(value);
      continue;
    }

    if (key === "sitemap") {
      if (value && !seenSitemaps.has(value) && sitemaps.length < MAX_SITEMAPS) {
        seenSitemaps.add(value);
        sitemaps.push(value);
      }
      continue;
    }

    if (key === "disallow" || key === "allow") {
      collectingAgents = false;
      if (!current) continue; // rule before any user-agent is ignored
      if (ruleCount >= MAX_RULES) continue;
      ruleCount++;
      current.rules.push({
        type: key === "allow" ? "allow" : "disallow",
        path: value,
      });
      continue;
    }

    // Unknown directive: does not break an in-progress user-agent run.
  }

  return { groups, sitemaps };
}

/**
 * Convert a robots path pattern into a matcher. `*` matches any sequence and a
 * trailing `$` anchors to the end of the path. Matching starts at the START of
 * the path (prefix semantics).
 */
function matchesPattern(pattern: string, path: string): boolean {
  let anchored = false;
  let body = pattern;
  if (body.endsWith("$")) {
    anchored = true;
    body = body.slice(0, -1);
  }

  const segments = body.split("*");
  let index = 0;
  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s];
    if (segment === "") {
      // Consecutive wildcards or leading/trailing wildcard: nothing to match.
      continue;
    }
    if (s === 0) {
      // First literal must match at the start.
      if (!path.startsWith(segment, index)) return false;
      index += segment.length;
    } else {
      const found = path.indexOf(segment, index);
      if (found === -1) return false;
      index = found + segment.length;
    }
  }

  if (anchored) {
    // If the pattern ended with a wildcard, the end anchor is satisfied by any
    // remaining suffix; otherwise the consumed position must reach the end.
    if (body.endsWith("*")) return true;
    return index === path.length;
  }
  return true;
}

/**
 * Specificity of a rule = number of literal characters in the pattern,
 * ignoring `*` and a trailing `$`.
 */
function specificity(pattern: string): number {
  let body = pattern;
  if (body.endsWith("$")) body = body.slice(0, -1);
  return body.replace(/\*/g, "").length;
}

function selectGroup(
  rules: RobotsRules,
  userAgent: string,
): RobotsGroup["rules"] | undefined {
  const lowerAgent = userAgent.toLowerCase();
  let bestLength = -1;
  let starRules: RobotsGroup["rules"] | undefined;
  let bestRules: RobotsGroup["rules"] | undefined;

  for (const group of rules.groups) {
    for (const token of group.agents) {
      if (token === "*") {
        // Merge all `*` groups together.
        starRules = [...(starRules ?? []), ...group.rules];
        continue;
      }
      if (lowerAgent.includes(token.toLowerCase())) {
        if (token.length > bestLength) {
          bestLength = token.length;
          bestRules = [...group.rules];
        } else if (token.length === bestLength && bestRules) {
          bestRules = [...bestRules, ...group.rules];
        }
      }
    }
  }

  return bestRules ?? starRules;
}

export function isPathAllowed(
  rules: RobotsRules,
  path: string,
  userAgent: string = ROBOTS_USER_AGENT,
): boolean {
  const applicable = selectGroup(rules, userAgent);
  if (!applicable) return true; // no group matches → allow

  let decision: "allow" | "disallow" | undefined;
  let bestSpecificity = -1;

  for (const rule of applicable) {
    // An empty Disallow value matches nothing (explicitly allows all).
    if (rule.path === "") continue;
    if (!matchesPattern(rule.path, path)) continue;
    const score = specificity(rule.path);
    if (
      score > bestSpecificity ||
      (score === bestSpecificity && rule.type === "allow")
    ) {
      bestSpecificity = score;
      decision = rule.type;
    }
  }

  if (!decision) return true; // no rule matches → allow
  return decision === "allow";
}

/**
 * Fetch and parse `/robots.txt` at the site origin. FAIL OPEN: on any non-2xx
 * response or any thrown error we return `found: false` with empty rules so
 * that crawling proceeds rather than being blocked by an unreachable or broken
 * robots endpoint.
 */
export async function fetchRobots(
  site: URL | string,
  fetcher?: typeof fetch,
  byteBudget?: ResponseByteBudget,
): Promise<{ found: boolean; url: string; rules: RobotsRules }> {
  const origin = normalizePublicUrl(site.toString());
  const robotsUrl = new URL("/robots.txt", origin);
  try {
    const response = await fetchBounded(robotsUrl, {
      maxBytes: LIMITS.maxSitemapBytes,
      accept: "text/plain,*/*;q=0.1",
      fetcher,
      byteBudget,
    });
    if (!response.status.toString().startsWith("2")) {
      return { found: false, url: robotsUrl.toString(), rules: emptyRules() };
    }
    const text = new TextDecoder().decode(response.bytes);
    return { found: true, url: robotsUrl.toString(), rules: parseRobots(text) };
  } catch {
    return { found: false, url: robotsUrl.toString(), rules: emptyRules() };
  }
}
