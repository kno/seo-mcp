import { describe, expect, it } from "vitest";
import {
  linkCheckResultSchema,
  linkProbeSchema,
} from "../../src/schemas/links";

describe("linkProbeSchema", () => {
  it("accepts an ok probe with status and redirects", () => {
    const fixture = {
      url: "https://example.com/about",
      state: "ok",
      status: 200,
      redirects: 0,
    };
    expect(linkProbeSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a broken probe without redirects", () => {
    const fixture = {
      url: "https://example.com/missing",
      state: "broken",
      status: 404,
    };
    expect(linkProbeSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts an error probe with only an error message", () => {
    const fixture = {
      url: "https://example.com/timeout",
      state: "error",
      error: "Link probe timed out",
    };
    expect(linkProbeSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects an unknown state value", () => {
    const fixture = { url: "https://example.com/x", state: "unknown" };
    expect(() => linkProbeSchema.parse(fixture)).toThrow();
  });
});

describe("linkCheckResultSchema", () => {
  it("accepts a result whose nested probes cover ok, broken and error states", () => {
    const fixture = {
      url: "https://example.com/",
      pageStatus: 200,
      checked: 3,
      ok: 1,
      broken: 1,
      errors: 1,
      results: [
        {
          url: "https://example.com/a",
          state: "ok",
          status: 200,
          redirects: 0,
        },
        { url: "https://example.com/b", state: "broken", status: 404 },
        {
          url: "https://example.com/c",
          state: "error",
          error: "Link probe timed out",
        },
      ],
    };
    expect(linkCheckResultSchema.parse(fixture)).toEqual(fixture);
  });
});
