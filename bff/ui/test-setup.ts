/**
 * Shared setup for the `ui` vitest project (jsdom). Extends `expect` with
 * `@testing-library/jest-dom` DOM matchers and `vitest-axe` accessibility
 * matchers, and pulls in their ambient type augmentations so `toHaveNoViolations`
 * and friends typecheck under `bff/ui/tsconfig.json`.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// `@testing-library/react` does not auto-register DOM cleanup for vitest;
// without this, each test's rendered tree accumulates in jsdom's shared
// document and later `getByRole`/`getByText` queries see prior tests' output.
afterEach(() => {
  cleanup();
});

// NOTE: `vitest-axe`'s `toHaveNoViolations` custom matcher ships type
// declarations written against an older vitest global-namespace shape
// (`Vi.Assertion`) that vitest 3.x's `@vitest/expect` no longer exposes,
// so extending `expect` with it produces an untypeable matcher under this
// project's `tsc`. Tests instead call `axe()` directly and assert on
// `results.violations` (see `StateRegion.a11y.test.tsx`, `App.test.tsx`) —
// a real, typed assertion with identical runtime behavior.
