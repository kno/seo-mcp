import { McpServer } from "@modelcontextprotocol/server";
import type { Env } from "./config";
import { registerCrawlTools } from "./mcp-tools/crawl";
import { registerSearchConsoleTools } from "./mcp-tools/search-console";
import { registerIntelligenceTools } from "./mcp-tools/intelligence";
import {
  registerKeywordsTools,
  type KeywordsRequestContext,
} from "./mcp-tools/keywords";
import { registerCrawlHistoryTools } from "./mcp-tools/crawl-history";
import { registerBusinessTools } from "./mcp-tools/business";
import { registerSitesTools } from "./mcp-tools/sites";
import { registerSiteCredentialsTools } from "./mcp-tools/site-credentials";

export type { KeywordsRequestContext as McpRequestContext };

export function buildServer(
  env: Env,
  requestContext?: KeywordsRequestContext,
): McpServer {
  const server = new McpServer(
    { name: "seo-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  registerCrawlTools(server, env);
  registerSearchConsoleTools(server, env);
  registerIntelligenceTools(server, env);
  registerKeywordsTools(server, env, requestContext);
  registerCrawlHistoryTools(server, env);
  registerBusinessTools(server, env);
  registerSitesTools(server, env);
  registerSiteCredentialsTools(server, env);

  return server;
}
