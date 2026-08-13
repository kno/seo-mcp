import { describe, expect, it } from "vitest";
import type { BffError, BffErrorCode } from "../../../src/errors";
import { ERROR_PRESENTATION, presentFor } from "./errors";

describe("ERROR_PRESENTATION", () => {
  it("has a distinct presentation for every BffErrorCode", () => {
    // `Object.keys` on a `Record<BffErrorCode, ...>` is itself proof the
    // mapping is exhaustive at the VALUE level; the compile-time guarantee
    // (a missing key fails `tsc`) is enforced by `errors.ts`'s own type
    // annotation and is verified separately (see apply-progress).
    const codes = Object.keys(ERROR_PRESENTATION) as BffErrorCode[];
    expect(codes).toHaveLength(16);
    const titles = new Set(codes.map((code) => ERROR_PRESENTATION[code].title));
    expect(titles.size).toBe(16);
  });
});

describe("presentFor", () => {
  it("maps upstream_unauthorized to a non-retryable, operator-action presentation", () => {
    const error: BffError = {
      code: "upstream_unauthorized",
      message: "The upstream service rejected the BFF's credentials.",
    };
    const presentation = presentFor(error);
    expect(presentation.operatorActionRequired).toBe(true);
    expect(presentation.retry.kind).toBe("disabled-permanent");
  });

  it("maps upstream_rate_limited to a distinct presentation from upstream_unauthorized", () => {
    const rateLimited = presentFor({
      code: "upstream_rate_limited",
      message: "The shared upstream rate limit has been exceeded.",
    });
    const unauthorized = presentFor({
      code: "upstream_unauthorized",
      message: "The upstream service rejected the BFF's credentials.",
    });
    expect(rateLimited.title).not.toBe(unauthorized.title);
  });

  it("attaches a countdown retry affordance carrying the real retryAfter value", () => {
    const presentation = presentFor({
      code: "upstream_rate_limited",
      message: "The shared upstream rate limit has been exceeded.",
      retryAfter: 60,
    });
    expect(presentation.retry).toEqual({
      kind: "disabled-until-elapsed",
      retryAfterSeconds: 60,
    });
  });

  it("distinguishes upstream_storage_not_configured from insufficient_snapshots — neither collapses into tool_failed", () => {
    const notConfigured = presentFor({
      code: "upstream_storage_not_configured",
      message: "not configured",
    });
    const insufficient = presentFor({
      code: "insufficient_snapshots",
      message: "need two",
    });
    const toolFailed = presentFor({ code: "tool_failed", message: "failed" });
    expect(notConfigured.title).not.toBe(insufficient.title);
    expect(notConfigured.title).not.toBe(toolFailed.title);
    expect(insufficient.title).not.toBe(toolFailed.title);
    expect(notConfigured.operatorActionRequired).toBe(true);
    expect(insufficient.operatorActionRequired).toBe(false);
  });

  it("falls back to an explicit unmapped state naming the raw code and message, never empty/success", () => {
    const unknownCode = "upstream_teapot" as unknown as BffErrorCode;
    const presentation = presentFor({
      code: unknownCode,
      message: "The server refused to brew coffee.",
    });
    expect(presentation.code).toBe("unmapped");
    expect(presentation.title).toContain("upstream_teapot");
    expect(presentation.description).toContain(
      "The server refused to brew coffee.",
    );
  });
});
