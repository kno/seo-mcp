import { describe, expect, it, vi } from "vitest";
import {
  ROBOTS_USER_AGENT,
  fetchRobots,
  isPathAllowed,
  parseRobots,
} from "../src/crawl/robots";

describe("parseRobots", () => {
  it("parses a single group with allow and disallow rules", () => {
    const rules = parseRobots(
      ["User-agent: *", "Disallow: /private", "Allow: /private/public"].join(
        "\n",
      ),
    );
    expect(rules.groups).toHaveLength(1);
    expect(rules.groups[0].agents).toEqual(["*"]);
    expect(rules.groups[0].rules).toEqual([
      { type: "disallow", path: "/private" },
      { type: "allow", path: "/private/public" },
    ]);
    expect(rules.sitemaps).toEqual([]);
  });

  it("ignores blank lines and comments, is case-insensitive on keys", () => {
    const rules = parseRobots(
      [
        "# a comment",
        "",
        "USER-AGENT: googlebot",
        "  # inline-ish comment line",
        "disallow: /a",
        "",
      ].join("\n"),
    );
    expect(rules.groups).toHaveLength(1);
    expect(rules.groups[0].agents).toEqual(["googlebot"]);
    expect(rules.groups[0].rules).toEqual([{ type: "disallow", path: "/a" }]);
  });

  it("groups consecutive user-agent lines together", () => {
    const rules = parseRobots(
      [
        "User-agent: alpha",
        "User-agent: beta",
        "Disallow: /x",
        "User-agent: gamma",
        "Disallow: /y",
      ].join("\n"),
    );
    expect(rules.groups).toHaveLength(2);
    expect(rules.groups[0].agents).toEqual(["alpha", "beta"]);
    expect(rules.groups[0].rules).toEqual([{ type: "disallow", path: "/x" }]);
    expect(rules.groups[1].agents).toEqual(["gamma"]);
    expect(rules.groups[1].rules).toEqual([{ type: "disallow", path: "/y" }]);
  });

  it("collects sitemap directives globally, deduped and capped at 20", () => {
    const lines = ["User-agent: *", "Disallow: /"];
    for (let i = 0; i < 25; i++)
      lines.push(`Sitemap: https://example.com/sitemap-${i}.xml`);
    lines.push("Sitemap: https://example.com/sitemap-0.xml"); // duplicate
    const rules = parseRobots(lines.join("\n"));
    expect(rules.sitemaps).toHaveLength(20);
    expect(rules.sitemaps[0]).toBe("https://example.com/sitemap-0.xml");
  });

  it("ignores malformed lines without a colon", () => {
    const rules = parseRobots(
      ["User-agent: *", "this is not valid", "Disallow: /z"].join("\n"),
    );
    expect(rules.groups[0].rules).toEqual([{ type: "disallow", path: "/z" }]);
  });

  it("ignores rules that appear before any user-agent", () => {
    const rules = parseRobots(
      ["Disallow: /orphan", "User-agent: *", "Disallow: /real"].join("\n"),
    );
    expect(rules.groups).toHaveLength(1);
    expect(rules.groups[0].rules).toEqual([
      { type: "disallow", path: "/real" },
    ]);
  });
});

describe("isPathAllowed", () => {
  it("disallows a simple prefix match", () => {
    const rules = parseRobots(["User-agent: *", "Disallow: /admin"].join("\n"));
    expect(isPathAllowed(rules, "/admin/settings")).toBe(false);
    expect(isPathAllowed(rules, "/public")).toBe(true);
  });

  it("lets allow override disallow on a specificity tie", () => {
    const rules = parseRobots(
      ["User-agent: *", "Disallow: /page", "Allow: /page"].join("\n"),
    );
    expect(isPathAllowed(rules, "/page")).toBe(true);
  });

  it("supports a mid-pattern wildcard", () => {
    const rules = parseRobots(
      ["User-agent: *", "Disallow: /a/*/secret"].join("\n"),
    );
    expect(isPathAllowed(rules, "/a/b/secret")).toBe(false);
    expect(isPathAllowed(rules, "/a/b/public")).toBe(true);
  });

  it("supports a trailing $ end-anchor", () => {
    const rules = parseRobots(
      ["User-agent: *", "Disallow: /*.pdf$"].join("\n"),
    );
    expect(isPathAllowed(rules, "/doc.pdf")).toBe(false);
    expect(isPathAllowed(rules, "/doc.pdf?x=1")).toBe(true);
  });

  it("prefers a specific user-agent group over the * group", () => {
    const rules = parseRobots(
      ["User-agent: *", "Disallow: /", "User-agent: seo-mcp", "Allow: /"].join(
        "\n",
      ),
    );
    expect(isPathAllowed(rules, "/anything")).toBe(true);
    expect(isPathAllowed(rules, "/anything", "OtherBot")).toBe(false);
  });

  it("treats an empty Disallow value as allow-all", () => {
    const rules = parseRobots(["User-agent: *", "Disallow:"].join("\n"));
    expect(isPathAllowed(rules, "/anything")).toBe(true);
  });

  it("allows when no group matches the user-agent", () => {
    const rules = parseRobots(
      ["User-agent: googlebot", "Disallow: /"].join("\n"),
    );
    expect(isPathAllowed(rules, "/x", "seo-mcp")).toBe(true);
  });

  it("lets the longest matching rule decide", () => {
    const rules = parseRobots(
      ["User-agent: *", "Disallow: /a", "Allow: /a/b/c"].join("\n"),
    );
    expect(isPathAllowed(rules, "/a/b/c/d")).toBe(true);
    expect(isPathAllowed(rules, "/a/b")).toBe(false);
  });
});

describe("fetchRobots", () => {
  it("fetches and parses robots.txt on a 2xx", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response("User-agent: *\nDisallow: /private", {
          headers: { "content-type": "text/plain" },
        }),
    );
    const result = await fetchRobots("https://example.com/start", fetcher);
    expect(result.found).toBe(true);
    expect(result.url).toBe("https://example.com/robots.txt");
    expect(result.rules.groups).toHaveLength(1);
    expect(isPathAllowed(result.rules, "/private")).toBe(false);
  });

  it("fails open on a non-2xx status", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response("nope", { status: 404 }),
    );
    const result = await fetchRobots("https://example.com", fetcher);
    expect(result.found).toBe(false);
    expect(result.rules).toEqual({ groups: [], sitemaps: [] });
    expect(isPathAllowed(result.rules, "/anything")).toBe(true);
  });

  it("fails open when the fetch throws", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("network down");
    });
    const result = await fetchRobots("https://example.com", fetcher);
    expect(result.found).toBe(false);
    expect(result.rules).toEqual({ groups: [], sitemaps: [] });
  });

  it("uses ROBOTS_USER_AGENT as the default user agent token", () => {
    expect(ROBOTS_USER_AGENT).toBe("seo-mcp");
  });
});
