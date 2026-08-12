import { describe, expect, it } from "vitest";
import { healthSchema } from "../../src/schemas/health";

describe("healthSchema", () => {
  it("accepts a well-formed health fixture", () => {
    const fixture = { status: "ok", service: "seo-mcp", version: "0.1.0" };
    expect(healthSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a fixture missing a required field", () => {
    const fixture = { status: "ok", service: "seo-mcp" };
    expect(() => healthSchema.parse(fixture)).toThrow();
  });
});
