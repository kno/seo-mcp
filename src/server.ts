import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Env } from "./config";
import { crawlPage } from "./crawl/page";
import { crawlSite } from "./crawl/site";
import { checkLinks } from "./crawl/links";
import { analyzePageSpeed } from "./pagespeed/client";
import { searchConsoleQuery } from "./google/search-console";

const jsonResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});

const errorResult = (error: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: error instanceof Error ? error.message : "Unexpected error",
    },
  ],
  isError: true,
});

export function buildServer(env: Env): McpServer {
  const server = new McpServer(
    { name: "seo-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "health",
    {
      description: "Check whether the SEO MCP Worker is ready.",
      inputSchema: z.object({}),
    },
    async () =>
      jsonResult({ status: "ok", service: "seo-mcp", version: "0.1.0" }),
  );

  server.registerTool(
    "crawl_page",
    {
      description:
        "Fetch one public HTML page and return bounded, deterministic on-page SEO signals and issues.",
      inputSchema: z.object({
        url: z.url().describe("Public HTTP or HTTPS page URL"),
      }),
    },
    async ({ url }) => {
      try {
        return jsonResult(await crawlPage(url));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "crawl_site",
    {
      description:
        "Read a site's bounded sitemap and analyze up to 20 same-origin HTML pages without recursive link crawling.",
      inputSchema: z.object({
        url: z.url().describe("Public HTTP or HTTPS site URL"),
        limit: z.number().int().min(1).max(20).default(10),
        concurrency: z.number().int().min(1).max(4).default(4),
      }),
    },
    async ({ url, limit, concurrency }) => {
      try {
        return jsonResult(await crawlSite(url, limit, concurrency));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "check_links",
    {
      description:
        "Fetch one public page and probe its links, reporting broken (4xx/5xx) and unreachable links within a bounded subrequest budget.",
      inputSchema: z.object({
        url: z.url().describe("Public HTTP or HTTPS page URL"),
      }),
    },
    async ({ url }) => {
      try {
        return jsonResult(await checkLinks(url));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "analyze_pagespeed",
    {
      description:
        "Run Google PageSpeed Insights v5 and return normalized performance, lab metrics, optional field INP, and top opportunities.",
      inputSchema: z.object({
        url: z.url().describe("Public HTTP or HTTPS page URL"),
        strategy: z.enum(["mobile", "desktop"]).default("mobile"),
        apiKey: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Google PageSpeed API key. Overrides the PAGESPEED_API_KEY environment variable when provided.",
          ),
      }),
    },
    async ({ url, strategy, apiKey }) => {
      try {
        return jsonResult(
          await analyzePageSpeed(url, strategy, env, undefined, apiKey),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search_console_query",
    {
      description:
        "Query Google Search Console Search Analytics (single-tenant) for rows by dimension over a date range.",
      inputSchema: z.object({
        siteUrl: z
          .string()
          .min(1)
          .describe(
            "Search Console property, e.g. 'sc-domain:example.com' or 'https://example.com/'",
          ),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
        dimensions: z
          .array(
            z.enum([
              "query",
              "page",
              "country",
              "device",
              "date",
              "searchAppearance",
            ]),
          )
          .optional(),
        rowLimit: z.number().int().min(1).max(250).optional(),
      }),
    },
    async ({ siteUrl, startDate, endDate, dimensions, rowLimit }) => {
      try {
        return jsonResult(
          await searchConsoleQuery(
            { siteUrl, startDate, endDate, dimensions, rowLimit },
            env,
          ),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
