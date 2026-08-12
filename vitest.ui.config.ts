import { defineConfig } from "vitest/config";

// Fourth vitest project (see `vitest.config.ts`'s `projects`), scoped to
// `bff/ui`. Runs in `jsdom` because `bff/ui` is a DOM-typed SPA project
// (see `bff/ui/tsconfig.json`), never the Workers runtime the other three
// projects use. Empty in Phase 1 — no `*.test.tsx` files exist yet; the
// first component/unit tests land starting in dashboard-views Phase 2.
export default defineConfig({
  test: {
    name: "ui",
    environment: "jsdom",
    include: ["bff/ui/**/*.test.tsx", "bff/ui/**/*.test.ts"],
  },
});
