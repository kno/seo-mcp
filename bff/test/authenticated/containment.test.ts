/**
 * Threat matrix row (b): no Google credential binding exists anywhere
 * reachable from `bff/`. This is a structural, not a procedural,
 * guarantee — the BFF never holds `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
 * `GOOGLE_REFRESH_TOKEN`, or any Ads credential; it reaches Google only
 * indirectly, through `env.SEO_MCP.fetch(...)`. This test scans every
 * TypeScript source file under `bff/src` (excluding `bff/ui`, which has its
 * own build and is out of scope for this containment claim) plus
 * `bff/wrangler.jsonc` for any of those identifiers and fails if any are
 * found — a regression fence against a future authenticated route
 * accidentally introducing a credential binding.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_IDENTIFIERS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
];

const BFF_SRC_DIR = join(__dirname, "../../src");
const BFF_WRANGLER_JSONC = join(__dirname, "../../wrangler.jsonc");

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (full.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("Google credential containment — structural (threat row b)", () => {
  it("no file under bff/src references a Google credential identifier", () => {
    const files = collectSourceFiles(BFF_SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const identifier of FORBIDDEN_IDENTIFIERS) {
        expect(content).not.toContain(identifier);
      }
    }
  });

  it("bff/src/env.d.ts declares no Google credential binding on Env", () => {
    const content = readFileSync(join(BFF_SRC_DIR, "env.d.ts"), "utf8");
    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      expect(content).not.toContain(identifier);
    }
  });

  it("bff/wrangler.jsonc declares no Google credential var or secret placeholder", () => {
    const content = readFileSync(BFF_WRANGLER_JSONC, "utf8");
    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      expect(content).not.toContain(identifier);
    }
  });
});
