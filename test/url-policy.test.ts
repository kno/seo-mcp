import { describe, expect, it } from "vitest";
import {
  normalizePublicUrl,
  resolvePublicUrl,
} from "../src/security/url-policy";

describe("normalizePublicUrl", () => {
  it("normalizes safe public URLs", () => {
    expect(
      normalizePublicUrl("HTTPS://Example.COM:443/path#part").toString(),
    ).toBe("https://example.com/path");
    expect(normalizePublicUrl("https://example.com.../path").hostname).toBe(
      "example.com",
    );
  });

  it.each([
    "file:///etc/passwd",
    "http://localhost",
    "http://127.0.0.1",
    "http://2130706433",
    "http://10.0.0.1",
    "http://100.64.0.1",
    "http://192.0.2.1",
    "http://198.18.0.1",
    "http://203.0.113.1",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]",
    "http://[::ffff:7f00:1]",
    "http://[::ffff:0:7f00:1]",
    "http://[64:ff9b::7f00:1]",
    "http://[2001::1]",
    "http://[2001:db8::1]",
    "http://[2002:7f00:1::]",
    "http://[fc00::1]",
    "http://[fe80::1]",
    "http://service.internal",
    "https://user:secret@example.com",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => normalizePublicUrl(url)).toThrow();
  });

  it("validates redirect targets", () => {
    expect(() =>
      resolvePublicUrl(
        "http://127.0.0.1/admin",
        new URL("https://example.com"),
      ),
    ).toThrow();
  });
});
