import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Env } from "../config";
import {
  listBusinessLocations,
  getBusinessReviews,
  getBusinessPerformance,
  replyToReview,
  updateBusinessInfo,
  createLocalPost,
} from "../google/business";
import { jsonResult, errorResult } from "./shared";

export function registerBusinessTools(server: McpServer, env: Env): void {
  server.registerTool(
    "business_list_locations",
    {
      description:
        "Google Business Profile: list accessible accounts and the locations for the configured (or first) account.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return jsonResult(await listBusinessLocations(env));
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "business_get_reviews",
    {
      description:
        "Google Business Profile: list recent reviews (with replies) for a location.",
      inputSchema: z.object({
        location: z
          .string()
          .optional()
          .describe(
            "Full 'accounts/{a}/locations/{l}' path; defaults to GOOGLE_BUSINESS_LOCATION",
          ),
        pageSize: z.number().int().min(1).max(50).optional(),
      }),
    },
    async ({ location, pageSize }) => {
      try {
        return jsonResult(
          await getBusinessReviews({ location, pageSize }, env),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "business_get_performance",
    {
      description:
        "Google Business Profile: daily performance time series (impressions, calls, website clicks) for a location over a date range.",
      inputSchema: z.object({
        location: z.string().optional(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
        metrics: z.array(z.string()).optional(),
      }),
    },
    async ({ location, startDate, endDate, metrics }) => {
      try {
        return jsonResult(
          await getBusinessPerformance(
            { location, startDate, endDate, metrics },
            env,
          ),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "business_reply_review",
    {
      description:
        "Google Business Profile WRITE: post or update the owner reply to a review. Modifies your live public Business Profile — requires confirm: true.",
      inputSchema: z.object({
        review: z
          .string()
          .min(1)
          .describe("Full 'accounts/{a}/locations/{l}/reviews/{r}' path"),
        comment: z.string().min(1),
        confirm: z
          .boolean()
          .describe(
            "Must be true to execute this live write to your public Business Profile",
          ),
      }),
    },
    async ({ review, comment, confirm }) => {
      try {
        return jsonResult(
          await replyToReview({ review, comment, confirm }, env),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "business_update_info",
    {
      description:
        "Google Business Profile WRITE: patch location fields (title, website, hours, etc.). Modifies your live public Business Profile — requires confirm: true.",
      inputSchema: z.object({
        location: z.string().optional(),
        updateMask: z.string().min(1),
        fields: z.record(z.string(), z.unknown()),
        confirm: z
          .boolean()
          .describe(
            "Must be true to execute this live write to your public Business Profile",
          ),
      }),
    },
    async ({ location, updateMask, fields, confirm }) => {
      try {
        return jsonResult(
          await updateBusinessInfo(
            { location, updateMask, fields, confirm },
            env,
          ),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "business_create_post",
    {
      description:
        "Google Business Profile WRITE: publish a local post to a location. Modifies your live public Business Profile — requires confirm: true.",
      inputSchema: z.object({
        location: z.string().optional(),
        post: z.record(z.string(), z.unknown()),
        confirm: z
          .boolean()
          .describe(
            "Must be true to execute this live write to your public Business Profile",
          ),
      }),
    },
    async ({ location, post, confirm }) => {
      try {
        return jsonResult(
          await createLocalPost({ location, post, confirm }, env),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
