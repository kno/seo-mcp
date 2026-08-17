import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  probeSearchConsole,
  probeGoogleAds,
  CREDENTIAL_HEALTH_TTL_SECONDS,
  CREDENTIAL_HEALTH_PROBE_FAILED_TTL_SECONDS,
} from "../../src/google/health";
import { resetGoogleTokenCache } from "../../src/google/auth";
import type { GoogleOAuthCredentials } from "../../src/google/credential-types";

beforeEach(() => {
  resetGoogleTokenCache();
});

const CREDENTIALS: GoogleOAuthCredentials = {
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
};

function tokenAndDataDispatcher(dataResponse: () => Response) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = input.toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "access-123", expires_in: 3600 });
    }
    return dataResponse();
  });
}

describe("probeSearchConsole", () => {
  it("classifies permissionLevel siteUnverifiedUser as unhealthy(property_unverified)", async () => {
    const fetcher = tokenAndDataDispatcher(() =>
      Response.json({ permissionLevel: "siteUnverifiedUser" }),
    );

    const outcome = await probeSearchConsole(
      CREDENTIALS,
      "sc-domain:example.com",
      fetcher,
    );

    expect(outcome.state).toBe("unhealthy");
    expect(outcome.reason).toBe("property_unverified");
    expect(outcome.ttlSeconds).toBe(CREDENTIAL_HEALTH_TTL_SECONDS);
  });

  it("classifies a verified permissionLevel as healthy", async () => {
    const fetcher = tokenAndDataDispatcher(() =>
      Response.json({ permissionLevel: "siteOwner" }),
    );

    const outcome = await probeSearchConsole(
      CREDENTIALS,
      "sc-domain:example.com",
      fetcher,
    );

    expect(outcome.state).toBe("healthy");
    expect(outcome.ttlSeconds).toBe(CREDENTIAL_HEALTH_TTL_SECONDS);
  });

  it("classifies a transport error/timeout as unhealthy(probe_failed) with a 60s expiry", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "access-123", expires_in: 3600 });
      }
      throw new Error("network down");
    });

    const outcome = await probeSearchConsole(
      CREDENTIALS,
      "sc-domain:example.com",
      fetcher,
    );

    expect(outcome.state).toBe("unhealthy");
    expect(outcome.reason).toBe("probe_failed");
    expect(outcome.ttlSeconds).toBe(CREDENTIAL_HEALTH_PROBE_FAILED_TTL_SECONDS);
  });

  it("classifies a rejected token exchange as unhealthy(credential_rejected)", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );

    const outcome = await probeSearchConsole(
      CREDENTIALS,
      "sc-domain:example.com",
      fetcher,
    );

    expect(outcome.state).toBe("unhealthy");
    expect(outcome.reason).toBe("credential_rejected");
  });

  it("never includes credential material in detail", async () => {
    const fetcher = tokenAndDataDispatcher(() =>
      Response.json({ permissionLevel: "siteUnverifiedUser" }),
    );

    const outcome = await probeSearchConsole(
      CREDENTIALS,
      "sc-domain:example.com",
      fetcher,
    );

    expect(JSON.stringify(outcome)).not.toContain(CREDENTIALS.refreshToken);
    expect(JSON.stringify(outcome)).not.toContain(CREDENTIALS.clientSecret);
  });
});

describe("probeGoogleAds", () => {
  it("classifies zero accessible customers as unhealthy(ads_no_accessible_customer)", async () => {
    const fetcher = tokenAndDataDispatcher(() =>
      Response.json({ resourceNames: [] }),
    );

    const outcome = await probeGoogleAds(CREDENTIALS, "dev-token", fetcher);

    expect(outcome.state).toBe("unhealthy");
    expect(outcome.reason).toBe("ads_no_accessible_customer");
  });

  it("classifies more than one accessible customer as unhealthy(ads_customer_ambiguous)", async () => {
    const fetcher = tokenAndDataDispatcher(() =>
      Response.json({
        resourceNames: ["customers/111", "customers/222"],
      }),
    );

    const outcome = await probeGoogleAds(CREDENTIALS, "dev-token", fetcher);

    expect(outcome.state).toBe("unhealthy");
    expect(outcome.reason).toBe("ads_customer_ambiguous");
  });

  it("resolves adsCustomerId as a side effect of exactly one accessible customer", async () => {
    const fetcher = tokenAndDataDispatcher(() =>
      Response.json({ resourceNames: ["customers/12345"] }),
    );

    const outcome = await probeGoogleAds(CREDENTIALS, "dev-token", fetcher);

    expect(outcome.state).toBe("healthy");
    expect(outcome.adsCustomerId).toBe("12345");
  });

  it("classifies a transport error/timeout as unhealthy(probe_failed) with a 60s expiry", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "access-123", expires_in: 3600 });
      }
      throw new Error("timed out");
    });

    const outcome = await probeGoogleAds(CREDENTIALS, "dev-token", fetcher);

    expect(outcome.state).toBe("unhealthy");
    expect(outcome.reason).toBe("probe_failed");
    expect(outcome.ttlSeconds).toBe(CREDENTIAL_HEALTH_PROBE_FAILED_TTL_SECONDS);
  });
});
