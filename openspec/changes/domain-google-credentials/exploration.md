# Exploration: `domain-google-credentials`

Per-domain Google OAuth credentials (client_id/client_secret/refresh_token), replacing the single global credential set for Search Console, Ads, and Business Profile access.

## Current State

**Token exchange (single choke point):** `src/google/auth.ts:9-63` — `getGoogleAccessToken(env, fetcher, now)` is the ONLY place that exchanges a refresh token for an access token. It:

- Reads `env.GOOGLE_CLIENT_ID` / `env.GOOGLE_CLIENT_SECRET` / `env.GOOGLE_REFRESH_TOKEN` directly (`auth.ts:14-20`), throwing if any is missing.
- Caches the resulting access token in a **module-level mutable variable** `cache: { token; expiresAtMs } | null` (`auth.ts:3`), shared across every request handled by the same Worker isolate, with no key at all — today there is exactly one cached token, globally, for the whole deployment. This is the single biggest structural obstacle to "per domain": introducing per-domain credentials requires this cache to become keyed (e.g. by a hash of `client_id`+`refresh_token`) or removed. It also already violates `openspec/config.yaml`'s apply rule against module-level mutable request state — propose should decide whether to fix it as part of this change or explicitly grandfather it.
- Every call site (`src/google/search-console.ts:30`, `src/google/ads.ts:71` via `adsPost`, `src/google/business.ts:37` via `businessRequest`) calls `getGoogleAccessToken(env, ...)` with the **whole `Env`**, never a narrower credential object — widening this to a per-domain credential set is a signature change rippling to all three modules.

**Call sites reading the global secrets directly:**

- `src/config.ts:1-15` — `Env` declares `GOOGLE_CLIENT_ID?`, `GOOGLE_CLIENT_SECRET?`, `GOOGLE_REFRESH_TOKEN?`, `GOOGLE_ADS_DEVELOPER_TOKEN?`, `GOOGLE_ADS_CUSTOMER_ID?`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID?`, `PAGESPEED_API_KEY?`, `GOOGLE_BUSINESS_ACCOUNT?`, `GOOGLE_BUSINESS_LOCATION?`, `GSC_SNAPSHOT_PROPERTIES?`.
- `src/google/auth.ts:14-20,34-36` — client_id/secret/refresh_token, as above.
- `src/google/ads.ts:61-83` — `env.GOOGLE_ADS_DEVELOPER_TOKEN` (throws if missing), `env.GOOGLE_ADS_CUSTOMER_ID` as fallback when no per-call `customerId` given, `env.GOOGLE_ADS_LOGIN_CUSTOMER_ID` optionally added as a header. **Existing precedent:** `getKeywordMetrics`/`discoverKeywords` already accept an optional per-call `customerId` (`ads.ts:127-132,167-174`, threaded from `src/mcp-tools/keywords.ts:22,52` and `bff/src/router.ts:367-372,380-387`) — but this only swaps which Ads _customer account_ is billed/queried under the SAME OAuth client/developer token. Full "different Google Cloud project + different OAuth client" per domain is a materially larger jump.
- `src/google/business.ts:73-79,146` — `resolveLocation()` reads `env.GOOGLE_BUSINESS_LOCATION` fallback; `listBusinessLocations` reads `env.GOOGLE_BUSINESS_ACCOUNT` similarly.
- `src/pagespeed/client.ts:110-132` — `analyzePageSpeed(target, strategy, env, fetcher, apiKey)` already accepts an **optional per-call `apiKey` override** (`effectiveKey = apiKey ?? env.PAGESPEED_API_KEY`) that takes precedence over the global secret. Strongest existing precedent for "per-request/per-entity credential override wins over the global env secret." UI-side counterpart already exists: `bff/ui/src/organisms/PageSpeedForm.tsx:24-71,113-119` collects the key via an uncontrolled `<input type="password">`, wraps it in `SecretCell` (`bff/ui/src/data/secret.ts:23-52` — one-shot, non-`useState`, `.take()` returns the raw value exactly once, `toString()`/`toJSON()` return `"[SecretCell: redacted]"`), and the BFF forwards it via a POST-with-JSON-body route specifically to avoid leaking it into a GET query string/logs (`bff/src/router.ts:14-19,410-428,940-958`). This is the closest existing template for handling a new user-supplied Google credential in a form.

## Per-domain applicability — open ambiguity (not resolved here)

1. **Search Console / crawl-adjacent tools** — genuinely URL/site-scoped: `search_console_query`, `find_striking_distance_keywords`, `find_low_ctr_opportunities`, `snapshot_search_console`, `find_seo_opportunities`, `find_keyword_cannibalization`, `map_keywords_to_pages`, `find_content_gaps`, `analyze_domain` all take `siteUrl`/`url`. These map cleanly onto "look up the site's row in `sites`, use its credentials."
2. **Google Ads tools** (`get_keyword_metrics`, `discover_keywords`, `cluster_keywords`) — do **not** take a URL at all, only an optional `customerId`. `cluster_keywords` has no Google/account concept whatsoever (pure text clustering; not even in `bff/src/authenticated/registry.ts:60-66`). No existing parameter resolves "which domain's credentials" — either these tools gain a `siteUrl` param that doesn't exist today, or the BFF injects the resolved credentials server-side from the UI's "currently selected domain" (`SiteContext`). **Unresolved — propose must decide.**
3. **Business Profile tools** (`business_*`) — use Google Business **location resource names**, never a website URL, and are **not in the BFF's authenticated registry at all** (`bff/src/authenticated/registry.ts:6-15`, deliberately excluded since `dashboard-bff-foundations`) — unreachable through the dashboard today regardless of this change. "Per domain" has no natural mapping here. **Recommend declaring explicitly out-of-scope** rather than silently ignoring.
4. **PageSpeed** (`analyze_pagespeed`) — already URL-scoped with a working per-call override precedent, making it the easiest to convert — but the user's ask named only the three OAuth fields (`clientId`/`clientSecret`/`refreshToken`), not `PAGESPEED_API_KEY`. **Propose must confirm** whether the PageSpeed key is in scope or stays global/per-call as today.

## Security surface for storing OAuth secrets in D1

- **Web Crypto AES-GCM feasibility: confirmed**, with direct precedent to mirror. `bff/src/session.ts:19-22,52-60,73-101` already uses `globalThis.crypto.subtle.importKey("raw", ..., { name: "HMAC", hash: "SHA-256" }, false, [...])` to sign/verify session cookies. `src/http/auth.ts:5-14,43-69` uses `subtle.digest`/`subtle.timingSafeEqual` for the bearer-token check. An AES-GCM `importKey`/`encrypt`/`decrypt` for `client_secret`/`refresh_token` at rest would follow the same shape: import a raw key from a new Cloudflare secret (e.g. `DOMAIN_CREDENTIAL_ENCRYPTION_KEY`), random IV per write (`crypto.getRandomValues`), ciphertext+IV stored in the D1 row, decrypt on read. No AES/encrypt/decrypt code exists in the repo yet — genuinely new surface, not a refactor.
- **Logging/leak surface: no existing leak found.** `bff/src/mcp-client.ts:83-96` (`logUpstreamEvent`) only logs `{ event, tool, keyHash, status }`, never args/response bodies. `bff/src/router.ts`'s error handling returns `BffErrorCode`s, not raw upstream error text, by design — a new credential error path should follow the same discipline (never surface a Google token-endpoint error message verbatim, since it could echo partial credential info).

## The manual OAuth Playground process today

`AGENTS-seo.md` (present on disk at repo root, **currently untracked/not in git**) documents a fully manual flow: create a "Web application" OAuth client in Google Cloud Console, mint a refresh token via the OAuth Playground (gear icon → own credentials → force-approve → exchange code), hand-paste the three values into `.dev.vars`/`wrangler secret put`. Two options for the "add domain" form:

1. **Paste-manually (three text fields)** — matches the literal ask. `add_site`'s input schema gains `clientId`/`clientSecret`/`refreshToken`, encrypted before the D1 write, decrypted at credential-resolution time. User keeps using the Playground per domain.
   - Pros: matches the literal ask; smallest surface area; reuses `SecretCell`/POST-JSON/never-cached precedent already proven for `analyze_pagespeed`. No new OAuth infrastructure.
   - Cons: still fully manual per domain (Playground toil ×N domains); global secrets become a fallback tier needing an explicit precedence rule; doesn't resolve the Ads/Business-Profile ambiguity.
   - Effort: Medium.
2. **Full "Connect Google Account" OAuth flow per domain** — the BFF becomes an OAuth client with its own authorize/callback routes; the domain owner clicks "Connect" and consents; refresh token is minted and stored server-side automatically.
   - Pros: matches "each domain uses its own Google account" more literally (owner-driven consent, no manual copy-paste); eliminates the Playground dependency going forward.
   - Cons: materially larger — new routes, CSRF/state handling, a registered `redirect_uri` pointing at this app's real deployed origin, server-side refresh-on-expiry handling — and still needs the encrypted-storage layer from Approach 1 underneath it.
   - Effort: High.

The literal ask text ("añade esos datos al formulario para añadir dominios") supports Approach 1. Approach 2 is a legitimate alternative reading given "cada dominio con su propia cuenta de Google" and should be confirmed explicitly with the user before scoping, since it changes the shape of nearly every downstream artifact.

## Existing patterns to mirror

- `src/db/site-store.ts:41-65` — `result.meta.changes > 0` idiom (`INSERT OR IGNORE` for add, delete-count for remove).
- `src/schemas/sites.ts:9-41` — Zod schema per domain concept; a credentials sub-object should **never** include raw secret fields in any output schema — only a boolean "connected" flag should round-trip to the client, mirroring `PageSpeedForm`'s never-persisted-or-echoed discipline.
- `src/mcp-tools/sites.ts` / `shared.ts`'s `assertConfirmedDelete` — confirm-gating pattern, relevant if disconnecting/removing domain credentials needs the same two-step confirm the UI already implements (`ManageDomainsContainer.tsx:50-57`).
- `migrations/0003_sites.sql` — additive-only D1 migration convention (`CREATE TABLE IF NOT EXISTS`); a new migration (e.g. `0004_site_credentials.sql`) would be needed.
- Strict TDD is enabled repo-wide — every behavior-changing task should pair with its test.

## Affected Areas

`src/config.ts`, `src/google/auth.ts`, `src/google/search-console.ts`, `src/google/ads.ts`, `src/google/business.ts`, `src/pagespeed/client.ts`, `src/db/site-store.ts`, `src/schemas/sites.ts`, `src/mcp-tools/sites.ts`, `migrations/0003_sites.sql` (+ new migration), `bff/src/router.ts`, `bff/src/authenticated/registry.ts`, `bff/ui/src/app/SiteContext.tsx`, `bff/ui/src/containers/ManageDomainsContainer.tsx`, `bff/ui/src/data/secret.ts`, `AGENTS-seo.md` (untracked — consider bringing under version control as part of this change).

## Recommendation

Recommend **Approach 1** (paste-manual, encrypted at rest) as the default scope unless the user explicitly wants the OAuth-callback flow — it satisfies the literal request, has direct precedent already in this codebase, and doesn't block a later Approach-2 follow-up (the encrypted-storage layer Approach 1 builds is exactly what Approach 2 needs underneath it). Propose should explicitly resolve as separate decisions:
(a) manual-paste vs. connect-flow,
(b) how Google Ads tools bind to a domain (explicit `siteUrl` param vs. implicit active-site binding),
(c) Business Profile declared out-of-scope,
(d) whether `PAGESPEED_API_KEY` joins the per-domain model,
(e) whether `src/google/auth.ts`'s module-level token cache is fixed (keyed) as part of this change or explicitly deferred.

## Risks

- The module-level global token cache in `src/google/auth.ts:3` is not per-credential-safe and MUST be addressed (keyed cache or removed) — otherwise per-domain credential swapping can serve one domain's cached access token to a different domain's request within the same Worker isolate lifetime: a correctness and potential cross-tenant data-leak bug, not just a performance detail.
- No AES/encryption code exists yet in this repo — genuinely new surface; schedule dedicated test coverage. Key rotation is out of scope unless raised explicitly.
- Business Profile tools have no natural "domain" concept — scope-creep risk if design tries to force one rather than declaring it out of scope.
- `AGENTS-seo.md` is untracked; if design cites it, consider whether to `git add` it as part of this change.

## Ready for Proposal

Partially — the codebase mapping is complete and precise, but propose should not proceed silently on the five open decisions above. Surface at least the OAuth-flow question (manual paste vs. connect-flow) to the user explicitly before or during `sdd-propose`, since it changes the shape of nearly every downstream artifact.
