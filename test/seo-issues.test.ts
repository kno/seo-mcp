import { describe, expect, it } from "vitest";
import { detectSeoIssues, type PageSignals } from "../src/seo/analyze";

describe("detectSeoIssues", () => {
  it("reports actionable omissions", () => {
    const page: PageSignals = {
      title: "",
      description: "",
      h1: [],
      links: [],
      imageCount: 2,
      imagesMissingAlt: 1,
    };
    expect(detectSeoIssues(page).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "missing_title",
        "missing_description",
        "missing_h1",
        "images_missing_alt",
      ]),
    );
  });

  it("returns no issues for a complete page", () => {
    const page: PageSignals = {
      title: "A focused and descriptive page title",
      description: "A concise description.",
      canonical: "https://example.com",
      lang: "en",
      h1: ["Main heading"],
      links: [],
      imageCount: 1,
      imagesMissingAlt: 0,
    };
    expect(detectSeoIssues(page)).toEqual([]);
  });
});
