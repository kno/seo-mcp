import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Fourth vitest project (see `vitest.config.ts`'s `projects`), scoped to
// `bff/ui`. Runs in `jsdom` because `bff/ui` is a DOM-typed SPA project
// (see `bff/ui/tsconfig.json`), never the Workers runtime the other three
// projects use. Phase 2 (dashboard-views) adds the first `*.test.tsx`
// files — the shell primitives (`StateRegion`, `data/errors.ts`,
// `data/bounds.ts`, `data/client.ts`, atoms).
export default defineConfig({
  plugins: [react()],
  test: {
    name: "ui",
    environment: "jsdom",
    include: ["bff/ui/**/*.test.tsx", "bff/ui/**/*.test.ts"],
    setupFiles: ["bff/ui/test-setup.ts"],
  },
});
