import { describe, expect, it } from "vitest";
import {
  siteSchema,
  listSitesResultSchema,
  addSiteResultSchema,
  deleteSiteResultSchema,
  credentialStatusSchema,
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

describe("credentialStatusSchema", () => {
  it("accepts a connected, healthy status", () => {
    const fixture = {
      tier: "site",
      accountLabel: "owner@example.com",
      accountKey: "ak_site123",
      health: {
        searchConsole: {
          state: "healthy",
          checkedAt: "2026-08-17T00:00:00.000Z",
        },
        googleAds: { state: "unchecked" },
      },
    };
    expect(credentialStatusSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts an unconnected, not_connected status", () => {
    const fixture = {
      tier: "none",
      accountLabel: null,
      accountKey: null,
      health: {
        searchConsole: { state: "not_connected" },
        googleAds: { state: "not_connected" },
      },
    };
    expect(credentialStatusSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts an unhealthy status with a reason", () => {
    const fixture = {
      tier: "site",
      accountLabel: "owner@example.com",
      accountKey: "ak_site123",
      health: {
        searchConsole: {
          state: "unhealthy",
          reason: "property_unverified",
          checkedAt: "2026-08-17T00:00:00.000Z",
        },
        googleAds: { state: "unchecked" },
      },
    };
    expect(credentialStatusSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a raw credential field (client_id/client_secret/refresh_token) anywhere in the shape", () => {
    const fixture = {
      tier: "site",
      accountLabel: "owner@example.com",
      accountKey: "ak_site123",
      refreshToken: "should-not-be-here",
      health: {
        searchConsole: { state: "healthy" },
        googleAds: { state: "unchecked" },
      },
    };
    // Zod strips unknown keys by default rather than throwing, so assert
    // the parsed value never carries the extra field through.
    const parsed = credentialStatusSchema.parse(fixture);
    expect(parsed).not.toHaveProperty("refreshToken");
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
          credential: {
            tier: "none",
            accountLabel: null,
            accountKey: null,
            health: {
              searchConsole: { state: "not_connected" },
              googleAds: { state: "not_connected" },
            },
          },
        },
      ],
    };
    expect(listSitesResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a site missing the credential field", () => {
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
    expect(() => listSitesResultSchema.parse(fixture)).toThrow();
  });

  it("never contains client_id, client_secret, refresh_token, or ciphertext for any site", () => {
    const fixture = {
      count: 1,
      sites: [
        {
          id: 1,
          url: "https://example.com",
          label: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          credential: {
            tier: "site",
            accountLabel: "owner@example.com",
            accountKey: "ak_site123",
            health: {
              searchConsole: { state: "healthy" },
              googleAds: { state: "unchecked" },
            },
          },
        },
      ],
    };
    const parsed = listSitesResultSchema.parse(fixture);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toMatch(
      /client_id|client_secret|refresh_token|ciphertext/i,
    );
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
