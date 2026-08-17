import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Env } from "../config";
import { crawlPage } from "../crawl/page";
import { crawlSite } from "../crawl/site";
import { checkLinks } from "../crawl/links";
import { analyzePageSpeed } from "../pagespeed/client";
import { healthSchema } from "../schemas/health";
import { pageAnalysisSchema } from "../schemas/page";
import { siteCrawlResultSchema } from "../schemas/site";
import { linkCheckResultSchema } from "../schemas/links";
import { pageSpeedResultSchema } from "../schemas/pagespeed";
import { jsonResult, errorResult } from "./shared";

export function registerCrawlTools(server: McpServer, env: Env): void {
  server.registerTool(
    "health",
    {
      description: "Check whether the SEO MCP Worker is ready.",
      inputSchema: z.object({}),
      outputSchema: healthSchema,
    },
    async () =>
      jsonResult(healthSchema, {
        status: "ok",
        service: "seo-mcp",
        version: "0.1.0",
      }),
  );

  server.registerTool(
    "crawl_page",
    {
      description:
        "Fetch one public HTML page and return bounded, deterministic on-page SEO signals and issues.",
      inputSchema: z.object({
        url: z.url().describe("Public HTTP or HTTPS page URL"),
      }),
      outputSchema: pageAnalysisSchema,
    },
    async ({ url }) => {
      try {
        return jsonResult(pageAnalysisSchema, await crawlPage(url));
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
      outputSchema: siteCrawlResultSchema,
    },
    async ({ url, limit, concurrency }) => {
      try {
        return jsonResult(
          siteCrawlResultSchema,
          await crawlSite(url, limit, concurrency),
        );
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
      outputSchema: linkCheckResultSchema,
    },
    async ({ url }) => {
      try {
        return jsonResult(linkCheckResultSchema, await checkLinks(url));
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
      outputSchema: pageSpeedResultSchema,
    },
    async ({ url, strategy, apiKey }) => {
      try {
        return jsonResult(
          pageSpeedResultSchema,
          await analyzePageSpeed(url, strategy, env, undefined, apiKey),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
