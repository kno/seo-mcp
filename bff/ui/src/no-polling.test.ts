/**
 * Structural backstop for the `dashboard-shell` "No Polling, Auto-Refresh,
 * or Refresh-on-Focus" requirement. `data/client.ts`'s branded `UserIntent`
 * makes minting a fetch token from a non-gesture call site a type error
 * (see `apply-progress` for the concrete `tsc` failure), but a call site
 * could still bypass that with an explicit unsafe cast. This test greps the
 * REAL source tree — not a fixture or a hardcoded string — so a future
 * regression is caught even if it defeats the type system.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname); // bff/ui/src — this file lives at its root

const BANNED_TOKENS = ["visibilitychange", "setInterval"] as const;

// "focus" alone is too broad (it also names the DOM `.focus()` method this
// codebase's OWN focus-management code calls intentionally — see
// `StateRegion.tsx`). The requirement is about a *focus event listener*
// re-triggering a fetch, so scan for the addEventListener registration
// shape specifically instead of the bare word.
const FOCUS_LISTENER_PATTERN = /addEventListener\(\s*["'](focus|blur)["']/;

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (
      /\.(ts|tsx)$/.test(entry) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("no-polling structural invariant", () => {
  const files = collectSourceFiles(SRC_ROOT);

  it("scans at least one real production source file (proves this is not a placeholder)", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain(join(SRC_ROOT, "data", "client.ts"));
  });

  it.each(files.map((file) => [file] as const))(
    "%s registers no visibilitychange/setInterval",
    (file) => {
      const content = readFileSync(file, "utf-8");
      for (const token of BANNED_TOKENS) {
        expect(content, `${file} must not contain "${token}"`).not.toContain(
          token,
        );
      }
    },
  );

  it.each(files.map((file) => [file] as const))(
    "%s registers no focus/blur event listener",
    (file) => {
      const content = readFileSync(file, "utf-8");
      expect(
        FOCUS_LISTENER_PATTERN.test(content),
        `${file} must not register a "focus"/"blur" event listener`,
      ).toBe(false);
    },
  );

  it.each(files.map((file) => [file] as const))(
    "%s has no useEffect body that calls requestTool directly",
    (file) => {
      const content = readFileSync(file, "utf-8");
      // A `useEffect(...)` call whose body (up to its own closing, so this
      // is intentionally conservative rather than a full parser) contains
      // `requestTool(` is exactly the shape design.md's threat matrix names.
      const useEffectCalls =
        content.match(/useEffect\(([\s\S]*?)\n\s*\},?\s*\[[^\]]*\]\)/g) ?? [];
      for (const block of useEffectCalls) {
        expect(
          block.includes("requestTool("),
          `${file} has a useEffect body calling requestTool() directly`,
        ).toBe(false);
      }
    },
  );
});
