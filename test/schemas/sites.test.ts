import { describe, expect, it } from "vitest";
import {
  siteSchema,
  listSitesResultSchema,
  addSiteResultSchema,
  deleteSiteResultSchema,
} from "../../src/schemas/sites";

describe("siteSchema", () => {
  it("accepts a real Site fixture", () => {
    const fixture = {
      id: 1,
      url: "https://example.com",
      label: "Main site",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(siteSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a null label", () => {
    const fixture = {
      id: 1,
      url: "https://example.com",
      label: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(siteSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a missing label field (must be string | null, not optional)", () => {
    const fixture = {
      id: 1,
      url: "https://example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(() => siteSchema.parse(fixture)).toThrow();
  });
});

describe("listSitesResultSchema", () => {
  it("accepts a real fixture", () => {
    const fixture = {
      count: 1,
      sites: [
        {
          id: 1,
          url: "https://example.com",
          label: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    expect(listSitesResultSchema.parse(fixture)).toEqual(fixture);
  });
});

describe("addSiteResultSchema", () => {
  it("accepts an added-site result", () => {
    const fixture = {
      added: true,
      site: {
        id: 1,
        url: "https://example.com",
        label: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    };
    expect(addSiteResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a not-added result (duplicate url) with a null site", () => {
    const fixture = { added: false, site: null };
    expect(addSiteResultSchema.parse(fixture)).toEqual(fixture);
  });
});

describe("deleteSiteResultSchema", () => {
  it("accepts a successful deletion result", () => {
    const fixture = { siteId: 1, deleted: true };
    expect(deleteSiteResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a no-op deletion result (id did not exist)", () => {
    const fixture = { siteId: 999, deleted: false };
    expect(deleteSiteResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a payload missing deleted", () => {
    expect(() => deleteSiteResultSchema.parse({ siteId: 1 })).toThrow();
  });
});
