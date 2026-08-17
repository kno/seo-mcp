import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Env } from "../config";
import { listSites, addSite, deleteSite } from "../db/site-store";
import { credentialStatusForSite } from "../google/health";
import {
  listSitesResultSchema,
  addSiteResultSchema,
  deleteSiteResultSchema,
} from "../schemas/sites";
import { jsonResult, errorResult, assertConfirmedDelete } from "./shared";

export function registerSitesTools(server: McpServer, env: Env): void {
  server.registerTool(
    "list_sites",
    {
      description:
        "List the persisted domains the dashboard's global site selector remembers, in the order they were added.",
      inputSchema: z.object({}),
      outputSchema: listSitesResultSchema,
    },
    async () => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        const sites = await listSites(env.DB);
        const sitesWithCredential = await Promise.all(
          sites.map(async (site) => ({
            ...site,
            credential: await credentialStatusForSite(env, site),
          })),
        );
        return jsonResult(listSitesResultSchema, {
          count: sitesWithCredential.length,
          sites: sitesWithCredential,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "add_site",
    {
      description:
        "Add a domain to the persisted site list backing the dashboard's global site selector. Idempotent on url.",
      inputSchema: z.object({
        url: z.string().min(1),
        label: z.string().min(1).optional(),
      }),
      outputSchema: addSiteResultSchema,
    },
    async ({ url, label }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        const { added, site } = await addSite(env.DB, { url, label });
        return jsonResult(addSiteResultSchema, { added, site });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "delete_site",
    {
      description:
        "Delete a domain from the persisted site list. Requires confirm=true.",
      inputSchema: z.object({
        siteId: z.number().int().positive(),
        confirm: z.boolean(),
      }),
      outputSchema: deleteSiteResultSchema,
    },
    async ({ siteId, confirm }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        assertConfirmedDelete(confirm);
        const deleted = await deleteSite(env.DB, siteId);
        return jsonResult(deleteSiteResultSchema, { siteId, deleted });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
