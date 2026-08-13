import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `root` is resolved from this config file's own location (via
// `import.meta.url`, no Node types required — see the DOM-only
// `bff/ui/tsconfig.json`) rather than the invoking shell's cwd, so
// `build:ui`/`dev:ui` behave identically whether run from the repo root
// or from `bff/ui/` directly.
const root = new URL(".", import.meta.url).pathname;

export default defineConfig({
  root,
  // `@tailwindcss/vite` compiles `src/styles.css` (the single stylesheet,
  // imported once from `src/main.tsx`). Tailwind v4 needs no `tailwind.config.js`
  // — the design tokens live in that stylesheet's `@theme` block.
  plugins: [react(), tailwindcss()],
  build: {
    // Matches `bff/wrangler.jsonc`'s `assets.directory: "./ui/dist"`.
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // Local dev only: `wrangler dev -c bff/wrangler.jsonc` serves `/api`
    // and `/auth` on its default port; the Vite dev server proxies both
    // so the SPA can be developed with HMR against the real gate/API.
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/auth": "http://127.0.0.1:8787",
    },
  },
});
