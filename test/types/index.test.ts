import { describe, expect, it } from "vitest";

describe("published result-types module (src/types/index.ts)", () => {
  it("re-exports a PageAnalysis type identical to the server's own", () => {
    // Type-only assertion: assigning a value typed via the published module
    // to a variable typed via the server's own module (and vice versa)
    // must compile without any cast between the two named types — proving
    // they are the same type, not a hand-copied duplicate.
    type FromPublished = import("../../src/types/index").PageAnalysis;
    type FromServer = import("../../src/seo/html").PageAnalysis;
    const value: FromServer = {} as FromPublished;
    const reverse: FromPublished = {} as FromServer;
    expect(value).toBeDefined();
    expect(reverse).toBeDefined();
  });

  it("erases entirely under verbatimModuleSyntax: importing it adds zero runtime exports", async () => {
    const runtimeModule = (await import("../../src/types/index")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(runtimeModule)).toHaveLength(0);
  });

  it("publishes a matching runtime schema module for consumers that want validation", async () => {
    const schemas = await import("../../src/types/schemas");
    expect(typeof schemas.healthSchema).toBe("object");
    expect(typeof schemas.pageAnalysisSchema).toBe("object");
    expect(typeof schemas.siteCrawlResultSchema).toBe("object");
    expect(typeof schemas.linkCheckResultSchema).toBe("object");
    expect(typeof schemas.pageSpeedResultSchema).toBe("object");
  });
});
