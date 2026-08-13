/**
 * Minimal ambient stand-ins for Cloudflare Workers-exclusive globals with no
 * DOM equivalent (`HTMLRewriter`, `D1Database`, `RateLimit`). Needed because
 * `PageReportContainer.tsx`'s `import type { PageAnalysis } from
 * "../../../../src/types"` transitively pulls `src/seo/html.ts` and
 * `src/config.ts` into this project's TypeScript program for diagnostics,
 * even though `verbatimModuleSyntax` erases the import at runtime.
 *
 * Deliberately NOT `@cloudflare/workers-types` as a whole: that package's
 * own global `fetch`/`Request`/`Response` declarations collide with this
 * project's DOM lib, which is exactly the collision `bff/ui/tsconfig.json`
 * exists to avoid. These three symbols have no DOM equivalent, so declaring
 * them here carries no such risk. Signatures are intentionally loose —
 * this project never constructs or calls these types, it only needs `tsc`
 * to stop treating them as undefined names in code it never executes.
 */
declare class HTMLRewriter {
  on(selector: string, handlers: Record<string, (arg: any) => void>): this;
  transform(response: Response): Response;
}

interface D1Database {
  [key: string]: any;
}

interface RateLimit {
  [key: string]: any;
}
