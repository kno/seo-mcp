# Tasks: Per-Domain Google Credentials via "Connect Google Account"

Organized per design.md's "Migration / Rollout" six revertable slices, preceded by the blocking Phase 0
deploy prerequisite. `apply.tdd: true` (`openspec/config.yaml`) — every behavior-changing task is
RED (failing test) → GREEN (smallest implementation), test command `pnpm test`.

## Review Workload Forecast

| Field                    | Value                                                        |
| ------------------------ | ------------------------------------------------------------ |
| Estimated changed lines  | ~2,900-3,500 total; see per-slice estimate below             |
| Review budget            | 800 lines/PR                                                 |
| 400/800-line budget risk | High for Slice 4; Medium for Slices 1, 3, 6; Low for 0, 2, 5 |
| Chained PRs recommended  | Yes                                                          |
| Suggested split          | PR0 → PR1 → PR2 → PR3 → PR4a → PR4b → PR5 → PR6, stacked     |
| Delivery strategy        | ask-on-risk                                                  |
| Chain strategy           | stacked-to-main (proposed — confirm with user; see note)     |
| Test command             | `pnpm test`                                                  |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Why Slice 4 is split into 4a/4b.** Design's Slice 4 bundles the BFF OAuth routes
(`authorize`/`callback`/`state`), the `gate.ts` `SameSite=Lax` change, AND three new MCP tools
(`connect_google_account`, `disconnect_google_account`, `check_site_credentials`) plus their integration
tests (mocked token endpoint, full round-trip, containment assertions). Per design's own "higher risk:
auth surface" flag and the proposal's HIGH risk classification, this is the single largest, most
security-sensitive slice — estimated ~750-900 lines alone, risking the 800-line budget on its own even
before UI or ledger work. Splitting preserves an independent rollback boundary (4a routes are dead code
without 4b's tools; 4b's tools are unreachable without 4a's routes) while keeping each PR under budget.

**Orchestrator: this is the risk flag `ask-on-risk` requires stopping for.** Confirm chain strategy
(stacked-to-main vs. feature-branch-chain) with the user before `sdd-apply` starts Slice 4.

### Suggested Work Units

| Unit | Goal                                                      | PR   | Focused test command                                       | Runtime harness                                                      | Rollback boundary                                                              |
| ---- | --------------------------------------------------------- | ---- | ---------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 0    | Deploy `seo-dashboard-bff` w/ real KV                     | PR0  | N/A — infra, not code test                                 | `wrangler deployments list --name seo-dashboard-bff`                 | Not applicable (deploy only, no revert needed beyond `wrangler rollback`)      |
| 1    | Migration + crypto + store (no reader)                    | PR1  | `pnpm test -- credential-cipher site-credential-store`     | N/A — no reader wired; structural unit tests only                    | Drop the two new files + migration; unread by any live path                    |
| 2    | `resolveSiteCredentials` + keyed token cache + call sites | PR2  | `pnpm test -- credentials auth`                            | `test/integration/` MCP round-trip (behavior-identical)              | Revert `auth.ts`/`credentials.ts`; call sites revert to `env`-shaped signature |
| 3    | Health probes + state machine + `list_sites` status       | PR3  | `pnpm test -- health credentials`                          | `test/integration/` mocked GSC/Ads probe endpoints                   | Drop `health.ts`; `list_sites` drops `credential` field                        |
| 4a   | BFF OAuth routes + `state` token + `gate.ts` `Lax`        | PR4a | `pnpm test -- oauth state gate`                            | `bff/test/integration/` mocked Google token endpoint                 | Remove `bff/src/oauth/*`; router drops 2 routes; `gate.ts` reverts to `Strict` |
| 4b   | 3 new MCP tools (`connect/disconnect/check`)              | PR4b | `pnpm test -- site-credentials`                            | `bff/test/integration/` full authorize→callback→connected round-trip | Drop `src/mcp-tools/site-credentials.ts`; PR4a routes 404 with no tool to call |
| 5    | Credential-scoped BFF cache key + per-account ledger      | PR5  | `pnpm test -- cache quota-ledger`                          | `bff/test/integration/` KV, two `accountKey`s                        | Revert cache-key/ledger-key derivation to unscoped form                        |
| 6    | UI: Connect/Disconnect/Re-check, status column, gating    | PR6  | `pnpm test -- manage-domains site-context ads-quota-badge` | `bff/test/integration/` full route + a11y pass                       | Shell disabled/legacy view state; no server contract change                    |

Each PR is RED → GREEN → PROOF. RED = failing behavior test first. GREEN = smallest implementation.
PROOF = `pnpm test` green plus the unit's focused command and runtime harness.

**Structural-only note (per design's Testing Strategy and Migration/Rollout sections):** no task in Phase
0-6 below can be exercised against a real Google OAuth exchange locally — there is no public HTTPS
origin for local dev. Every integration test in Slices 3/4a/4b uses a **mocked Google token endpoint**.
Full end-to-end verification (real consent screen, real callback) is only possible after PR0 deploys a
real origin and the OAuth client's redirect URIs are registered — flag this explicitly at `sdd-verify`.

## Phase 0: Deploy `seo-dashboard-bff` (PR0) — blocking prerequisite

- [x] 0.1 Create the real Cloudflare KV namespace for `RESULT_CACHE` and replace the placeholder id in
      `bff/wrangler.jsonc:18` — done: namespace `a6e48a991b694ab3b96dc719b527a457`
- [x] 0.2 Deploy `seo-dashboard-bff` (`wrangler deploy` from `bff/`); confirm `wrangler deployments list
--name seo-dashboard-bff` returns a live deployment (currently "Worker not found") — done:
      `https://seo-dashboard-bff.seo-mpc.workers.dev`. `MCP_AUTH_TOKEN` rotated on both `seo-mcp` and
      `seo-dashboard-bff` to a shared new value (the prior production value was not recoverable from
      Cloudflare); `DASHBOARD_SECRET`/`DASHBOARD_SESSION_KEY` freshly generated for this deployment.
- [x] 0.3 Register `https://{deployed-origin}/auth/google/callback` on the existing Google OAuth client's
      authorized redirect URIs, alongside a tunnel URL for local dev testing — done by the user
      (`https://seo-dashboard-bff.seo-mpc.workers.dev/auth/google/callback` added)
- [x] 0.4 Record the deployed origin and confirm reachability (`curl` a known existing route, e.g.
      `/api/tools/health`, expecting a non-404 response) — confirmed: login (`POST /auth/session`) issues
      a session cookie, and an authenticated `GET /api/tools/health` returns `{"status":"ok"}` end-to-end
      through the real `seo-mcp` service binding
- [x] 0.5 PROOF: deployment confirmed live; note in the PR description that no OAuth-dependent task below
      can be end-to-end verified until this origin exists — every later test remains structural/mocked

## Phase 1: Migration + crypto + store, no reader (PR1) — `site-google-credentials`

- [x] 1.1 Create `migrations/0004_site_credentials.sql`: additive `CREATE TABLE IF NOT EXISTS
site_credentials` + `site_credential_health`, per design's exact schema; apply locally and confirm
      idempotent re-apply — done: applied via `wrangler d1 migrations apply seo-mcp-db --local`; confirmed
      idempotent both at wrangler's migration-tracking level (`✅ No migrations to apply!` on re-run) and by
      re-executing the raw SQL file directly (`CREATE TABLE IF NOT EXISTS` no-ops without error)
- [x] 1.2 RED `test/crypto/credential-cipher.test.ts`: round-trip encrypt/decrypt; tampered ciphertext
      fails closed (Threat Matrix row c, spec "A tampered ciphertext fails closed"); wrong key fails; wrong
      AAD (site B's `additionalData`) fails; IV differs across two writes of the same plaintext (spec "Each
      write uses a unique IV") — done: confirmed failing (`Cannot find module`) before 1.3
- [x] 1.3 GREEN `src/crypto/credential-cipher.ts`: AES-GCM-256 encrypt/decrypt, `subtle.importKey("raw",
…, { name: "AES-GCM" }, false, ["encrypt","decrypt"])`, random 12-byte IV per write,
      `additionalData = "site:{site_id}:refresh_token"` — done: all 5 RED tests pass
- [x] 1.4 RED `test/integration/site-credential-store.test.ts`: write persists ciphertext+IV never
      plaintext (spec "Refresh token is encrypted before the D1 write"); `deleteSite` batch-deletes both
      `site_credentials` and `site_credential_health` rows, not `ON DELETE CASCADE` (Threat Matrix row j) —
      **deviation**: placed under `test/integration/` (real Miniflare D1 via `cloudflare:test`), not
      `test/db/`, matching this repo's existing convention for every other D1-backed store test
      (`site-store.test.ts`, `crawl-store.test.ts`, `gsc-store.test.ts` all live there) — a `test/db/` unit
      test has no D1 binding available (the "unit" vitest project runs outside the Workers pool). Confirmed
      failing (`Cannot find module`) before 1.5
- [x] 1.5 GREEN `src/db/site-credential-store.ts`: read/write for both tables; `src/db/site-store.ts`'s
      `deleteSite` becomes an explicit `db.batch([...])` — done: 6 RED tests pass; also updated
      `site-store.test.ts`'s `beforeAll` to create the two new tables (it exercises the now-batched
      `deleteSite`)
- [x] 1.6 GREEN `src/config.ts`: add `DOMAIN_CREDENTIAL_ENCRYPTION_KEY` binding — done: added by hand, NOT
      via `wrangler types`. Confirmed this repo's `Env` interface in `src/config.ts` is hand-maintained: only
      `types:bff` exists in `package.json` (`wrangler types -c bff/wrangler.jsonc --path
bff/worker-configuration.d.ts`), scoped to the BFF worker only. The root `seo-mcp` worker has no
      equivalent `types` script and no generated `worker-configuration.d.ts`; every existing secret
      (`GOOGLE_CLIENT_ID` etc.) is a hand-written field on this same interface
- [x] 1.7 PROOF: `pnpm test -- credential-cipher site-credential-store` green (11 tests); full `pnpm test`
      green (157 files, 1444 tests); `pnpm typecheck` clean (required one fix: `base64Decode`'s return
      annotated `Uint8Array<ArrayBuffer>`, matching `bff/src/session.ts`'s existing pattern, since plain
      `Uint8Array` doesn't satisfy `BufferSource` under this repo's TS lib config); `pnpm run format:check`
      clean after one `prettier --write` pass on the two new `.ts` files. No reader wired yet, so this slice
      is unread by any live code path — no existing test's behavior changed

## Phase 2: `resolveSiteCredentials` + keyed token cache + call-site ripple (PR2) — `site-google-credentials`, `authenticated-source-contract`

- [x] 2.1 RED `test/google/credentials.test.ts`: site-tier resolves entirely site fields, `credentialSource:
"site"` (spec "A connected site resolves to its own credentials"); global fallback resolves entirely
      global fields, `credentialSource: "global"` (spec "An unconnected site falls back to the global
      tier"); tiers never mix (spec "Tiers are never mixed"); neither tier usable ⇒
      `credentialSource: "none"`, no partial-set call attempted (spec "Neither tier has usable
      credentials"); literal `"Google credentials are not configured"` still thrown verbatim when
      resolution has nothing to report — done: 7 RED tests, confirmed failing (`Cannot find module`) before
      2.2
- [x] 2.2 GREEN `src/google/credentials.ts`: `GoogleOAuthCredentials`, `ResolvedCredential`,
      `resolveSiteCredentials(env, siteUrl)` — done: site tier decrypts via Phase 1's
      `credential-cipher.ts`/`site-credential-store.ts`, falls through to global on any decrypt failure
      (never mixes tiers), throws the verbatim `"Google credentials are not configured"` literal when
      neither tier resolves (this is how `credentialSource: "none"` is represented at this layer — the
      design's own `ResolvedCredential.source` type is `"site" | "global"` only, so "none" is a thrown
      exception, not a returned value; also added `globalCredentials(env)` for `business.ts`/`ads.ts`, and
      `getSiteByUrl` to `src/db/site-store.ts` to resolve a site's row from its URL). **Deviation from
      design's literal type table**: `credentialKey`/`accountKey` derivation is NOT in this file — see 2.4's
      note; `credentialKey` is computed inside `src/google/auth.ts` only (never leaves it, per design),
      and `accountKey` for the site tier is read directly from the stored `site_credentials.account_key`
      column (computed once at connect time in Phase 4b), not re-derived here
- [x] 2.3 RED `test/google/auth.test.ts`: **two credential sets never share a cached access token**
      (headline test, Threat Matrix row f); expiry eviction; bound at `MAX_CACHED_TOKENS = 8`;
      `credentialKey` differs when only `refresh_token` differs; a RED test asserts no response/log/cache
      value contains a `credentialKey`-shaped value (Threat Matrix row c) — done: 9 RED tests (5 ported
      from the superseded `test/google-auth.test.ts`, 4 new), confirmed 8/9 failing before 2.4
- [x] 2.4 GREEN `src/google/auth.ts`: narrow `getGoogleAccessToken(credentials, fetcher?, now?)` signature;
      `Map<credentialKey, {token, expiresAtMs}>` keyed cache, bounded eviction (evict expired first, then
      oldest via `Map` insertion order); `resetGoogleTokenCache()` kept for tests — done: all 9 tests pass.
      Deleted the superseded `test/google-auth.test.ts` (root-level, pre-Phase-2 signature)
- [x] 2.5 GREEN ripple: `src/google/search-console.ts:30` (`searchConsoleQuery(params, credentials, ...)`
      replaces `env`); `src/google/ads.ts:71` (`adsPost(env, credentials, ...)` keeps `env` for
      app-level developer-token/customer-ID fallback); `src/google/business.ts:37` calls
      `globalCredentials(env)`, otherwise unchanged — done, with one structural deviation discovered mid-slice
      (see below), plus the call-site choices the assignment asked to flag explicitly: - **`search-console.ts` callers**: minimal-diff choice was to resolve credentials at the smallest
      possible scope. `opportunities.ts`/`seo/intelligence.ts`/`seo/keyword-pages.ts`'s exported wrapper
      functions themselves now take `credentials: GoogleOAuthCredentials` (mirroring
      `searchConsoleQuery`'s own signature change) instead of `env: Env`; the `resolveSiteCredentials(env,
siteUrl)` call moved up to their callers — `mcp-tools/search-console.ts`, `mcp-tools/intelligence.ts`,
      `src/scheduled.ts`, and `src/seo/domain-report.ts` (which resolves inside its existing try/catch, so
      a resolution failure surfaces as `gscError` exactly like a query failure already did). - **`adsPost`'s no-siteUrl constraint**: `adsPost` keeps its exact external signature (still `env:
Env` as its first param, per the assignment). Internally it calls `globalCredentials(env)` directly
      — NOT `resolveSiteCredentials(env, undefined)` — for a reason discovered only during typecheck (see
      deviation below): Ads has no `siteUrl` in this change's scope, so it should never touch the
      site-tier D1 path at all, not even one that resolves to a no-op. - **Structural deviation (discovered via `pnpm run typecheck`, not anticipated in design.md)**:
      `src/types/index.ts` is a type-only re-export barrel consumed by `bff/ui`'s DOM-only tsconfig (no
      `@cloudflare/workers-types`), and it re-exports result types from `search-console.ts`, `ads.ts`,
      `opportunities.ts`, `intelligence.ts`, and `keyword-pages.ts`. Giving any of those files a static
      import — even `import type` — of the original single `src/google/credentials.ts` (which internally
      imports `../db/site-store`/`../db/site-credential-store`, both D1-generic-typed) pulled
      `D1Database` generics into `bff/ui`'s type-check program, which has no types for them
      (`TS2347: Untyped function calls may not accept type arguments` on `.first<T>()`/`.all<T>()`).
      This is the exact same constraint the codebase already documents in `src/types/index.ts`'s own
      comments for `Site`/`StoredSnapshot`/`StoredCrawlSnapshot`/`DomainReport` (published from schema
      modules, not their D1 store modules) — Phase 2 just newly triggered it for the Google-source files.
      **Fix**: split `src/google/credentials.ts` into `src/google/credential-types.ts` (zero imports
      beyond `type Env`; holds `GoogleOAuthCredentials`, `ResolvedCredential`, `globalTier`,
      `globalCredentials` — safe for `bff/ui`) and `src/google/credentials.ts` (the D1-touching
      `resolveSiteCredentials`/`siteTier`, re-exporting the types for callers that need both). Every file
      reachable from `src/types/index.ts` imports only `credential-types.ts`; only
      `mcp-tools/search-console.ts`, `mcp-tools/intelligence.ts`, `src/scheduled.ts`, and
      `src/seo/domain-report.ts` (none reachable from `bff/ui`) import the real `credentials.ts`. This
      was NOT caught by `pnpm test` — only `pnpm run typecheck`'s second command (`tsc --noEmit -p
bff/ui`) surfaces it, because `bff/ui/tsconfig.json`'s `include` doesn't list these files directly
      but TypeScript still type-checks anything reachable by import - Updated every ripple test accordingly: `test/search-console.test.ts`, `test/opportunities.test.ts`,
      `test/intelligence.test.ts`, `test/keyword-pages.test.ts` now construct a `GoogleOAuthCredentials`
      object instead of an `Env`-shaped one and pass it positionally; `test/domain-report.test.ts`
      required no change (`analyzeDomain`'s own signature is unchanged). Two schema-registration
      integration tests that mock `search-console`/`intelligence`/`keyword-pages` wholesale
      (`test/integration/search-console-schema.test.ts`,
      `test/integration/opportunities-gsc-snapshots-schema.test.ts`,
      `test/integration/intelligence-domain-report-schema.test.ts`) also mock
      `src/google/credentials` now, since the real (unmocked) `resolveSiteCredentials` would otherwise
      run against their bare-bones fake `env` and throw before reaching the mocked function
- [x] 2.6 PROOF `test/integration/`: behavior-identical round-trip for every call site while no
      `site_credentials` row exists anywhere — this slice alone closes the cross-account token-cache leak
      (proposal Risk table row 1) — done: added `test/integration/credentials-resolution.test.ts` (5 tests,
      real Miniflare D1, no `site_credentials` row) proving `resolveSiteCredentials` falls back to global,
      and that `searchConsoleQuery`, `getKeywordMetrics` (Ads), and `listBusinessLocations` (Business
      Profile) all still complete end-to-end through the resolved global credentials. Full `pnpm test`
      green (159 files, 1461 tests); `pnpm typecheck` clean (both the root and `bff/ui` programs — see
      2.5's deviation note); `pnpm run format:check` clean after one `prettier --write` pass on the 6 new/
      changed files

## Phase 3: Health probes + state machine + `list_sites` status (PR3) — `site-google-credentials`

- [x] 3.1 RED `test/google/health.test.ts`: `sites.get` probe classifies `permissionLevel:
"siteUnverifiedUser"` ⇒ `unhealthy(property_unverified)` (spec-equivalent "invalid" state);
      `listAccessibleCustomers` zero customers ⇒ `unhealthy(ads_no_accessible_customer)`; more than one ⇒
      `unhealthy(ads_customer_ambiguous)`; transport error/timeout ⇒ `unhealthy(probe_failed)` with a 60s
      `expires_at`, not the 6h TTL — done: 10 RED tests, confirmed failing (`Cannot find module`) before 3.2
- [x] 3.2 GREEN `src/google/health.ts`: `sites.get` + `listAccessibleCustomers` probes; reason/detail
      derivation exactly per design's table; never includes credential material in `detail` — done: all 10
      tests pass. `probeSearchConsole`/`probeGoogleAds` derive `credential_rejected` (token exchange or
      401/403 API rejection), `property_not_accessible` (other non-2xx), `property_unverified`
      (`permissionLevel: "siteUnverifiedUser"`), `probe_failed` (transport/timeout, 60s TTL), and for Ads
      `ads_no_accessible_customer`/`ads_customer_ambiguous` from `resourceNames.length`; `adsCustomerId` is
      resolved as a side effect of exactly one accessible customer
- [x] 3.3 RED state-machine table: connect-time probe runs synchronously before "connected" is reported
      (spec "A successful connect marks the site healthy" / "...marks the site invalid, not silently
      connected"); selection-time probe runs only when cached record is absent/stale/tier-mismatched (spec
      "A fresh, healthy cached result is reused..." / "A stale cached result triggers a fresh probe..." /
      "A tier change invalidates the cached result even if it is fresh"); manual re-check bypasses the TTL
      (spec "Manual recheck clears an invalid state..."); listing never probes (spec "Listing sites never
      triggers a probe", Threat Matrix N/A-adjacent but load-bearing for cost); `checking` is never
      persisted; a real call's success extends `expires_at`, a real call's `upstream_credential_failure`
      directly downgrades without a probe — done: `test/integration/credential-health-state-machine.test.ts`
      (real Miniflare D1), 13 tests covering the full trigger table
- [x] 3.4 GREEN state-machine implementation wiring `site-credential-store.ts` health rows into the
      resolution path; `accountKey` drift on the health row invalidates a `healthy` result (spec "A tier
      change invalidates the cached result even if it is fresh") — done, in the same `src/google/health.ts`
      commit as 3.2 (probes and state machine were implemented together; the 3.3 RED tests were written
      against the already-complete implementation, confirmed passing on first run — no separate RED→GREEN
      gap was observable for this sub-task since the file did not exist as a partial artifact in between).
      **Where the logic lives**: NOT wired into `resolveSiteCredentials` — that function is the hot path for
      every real Search Console/Ads/Business call (`search-console.ts`/`ads.ts`/`business.ts`), and probing
      on every real call would violate "the health check runs at exactly three points, and nowhere else".
      Instead, new exported functions in `src/google/health.ts` that a caller must invoke explicitly:
      `checkSearchConsoleHealth`/`checkGoogleAdsHealth` (selection-time, gated on `isFresh` — absent, stale
      `expires_at`, or `accountKey` drift all force a probe; `{ forceRecheck: true }` bypasses the gate for
      manual recheck), `runConnectHealthCheck` (always-fresh dual probe for connect time), and
      `recordAuthenticatedCallSuccess`/`recordAuthenticatedCallFailure` (no probe; a real call's own outcome
      is written directly). None of these are wired into any live path yet — Phase 4b (connect/recheck
      tools) and Phase 5 (BFF real-call classification) are the future callers; this phase only builds and
      tests the primitives
- [x] 3.5 RED `test/schemas/sites.test.ts`: `list_sites` gains `credential: { tier, accountLabel,
accountKey, health: { searchConsole, googleAds } }`; zero Google calls when serving the list (spec
      "Listing sites never triggers a probe"); never exposes ciphertext, IV, `credentialKey`, or plaintext
      (spec "No raw credential value ever appears in the list schema") — done: extended
      `test/schemas/sites.test.ts` with `credentialStatusSchema`/`listSitesResultSchema` coverage.
      **Deviation from `site-google-credentials` spec.md's wording**: that spec describes a flatter
      `credentialHealth: "healthy"|"invalid"|"unchecked"` field; design.md's later, more detailed decision
      ("two persisted health states, five presented states") and tasks.md's own 3.5 wording both specify the
      nested `credential: { tier, accountLabel, accountKey, health: { searchConsole, googleAds } }` shape
      with five derived presented states (`not_connected`/`unchecked`/`stale`/`healthy`/`unhealthy`) per
      source. Implemented per design.md/tasks.md (the more recent, load-bearing artifacts per this phase's
      assignment) — flagged here as a spec.md/design.md drift for `sdd-verify`, not silently reconciled
- [x] 3.6 GREEN `src/schemas/sites.ts`: extend output schema; `src/mcp-tools/sites.ts` `list_sites`
      registration unchanged input, additive output only — done: `presentedHealthSchema` +
      `credentialStatusSchema` added; `listSitesResultSchema.sites` now
      `siteSchema.extend({ credential: credentialStatusSchema })` (only `list_sites`'s array — `siteSchema`
      itself, and `add_site`/`delete_site`'s use of it, are unchanged). `src/mcp-tools/sites.ts`'s `list_sites`
      handler now maps each listed site through the new `credentialStatusForSite(env, site)` (in
      `src/google/health.ts`) before returning — this reads only cached D1 rows (plus a local AES-GCM
      decrypt for tier resolution), never a Google call. Updated the pre-existing
      `test/integration/sites-schema.test.ts` round-trip assertion to include the new field
- [x] 3.7 PROOF `pnpm test -- health credentials`; `test/integration/` confirms `list_sites` round-trips the
      new field with no secret leak (Threat Matrix row c, i) — done: `pnpm test -- health credentials
sites-schema list-sites-credential` green (all pass); full `pnpm test` green (162 files, 1489 tests);
      `pnpm typecheck` clean (both root and `bff/ui` programs); `pnpm run format:check` clean after one
      `prettier --write` pass on the touched files. Added
      `test/integration/list-sites-credential.test.ts` (real Miniflare D1 via `buildServer`): a site with no
      credential row reports `tier: "none"`; a connected+healthy site round-trips
      `tier/accountLabel/health.searchConsole.state` correctly; both cases assert the stubbed global `fetch`
      is never called (zero Google calls) and that the serialized response never contains the raw refresh
      token, ciphertext, IV, encryption key, or `client_id`

## Phase 4a: BFF OAuth routes + `state` token + `gate.ts` `Lax` (PR4a) — `google-account-connect-flow`, `dashboard-bff`

- [x] 4a.1 RED `bff/test/oauth/state.test.ts`: forged signature rejected; replay (nonce already consumed)
      rejected; expired rejected; session-`sub` mismatch rejected; `siteId` tampering rejected (spec
      "A tampered state is rejected" / "A session-mismatched state is rejected" / "A replayed state is
      rejected on its second use" / "An expired state is rejected"; Threat Matrix row b) — done: 6 RED
      tests, confirmed failing (`Cannot find module`) before 4a.2
- [x] 4a.2 GREEN `bff/src/oauth/state.ts`: `HMAC-SHA-256` over `v1:oauth-state|{siteId}|{sub}|{nonce}|{exp}`
      keyed by new `GOOGLE_OAUTH_STATE_KEY` secret; single-use via `GET`+`DELETE` of `oauth-state:{nonce}`
      in KV, TTL 600s — done: all 6 tests pass. `siteId` tampering is caught structurally (any change to
      the signed message invalidates the HMAC, so it is rejected as `forged`, not a separate code path).
      `GOOGLE_OAUTH_STATE_KEY` added to `bff/src/env.d.ts`'s `Env` interface, `bff/.dev.vars` (local dev
      value), and `vitest.bff-integration.config.ts`'s Miniflare bindings, mirroring
      `DASHBOARD_SESSION_KEY`'s existing pattern. `RESULT_CACHE` (the existing KV binding) confirmed the
      right binding to reuse — `bff/wrangler.jsonc` declares no other KV namespace
- [x] 4a.3 RED `bff/test/oauth/authorize.test.ts`: unauthenticated request rejected before any KV write or
      redirect, no `state` minted (Threat Matrix row a); unknown `siteUrl` rejected before mint/redirect
      (spec "An authorize request for an unknown site is rejected before redirecting") — done: 3 RED tests,
      confirmed failing (`Cannot find module`) before 4a.4
- [x] 4a.4 GREEN `bff/src/oauth/authorize.ts`: behind `authenticate()`; mints `state`; redirects to Google
      with `access_type=offline&prompt=consent` and the three scopes design specifies — done: all 3 tests
      pass. Since the BFF has no D1, "known site" is resolved by calling the existing `list_sites` MCP tool
      and checking `siteId` membership, before any KV write. Added `GOOGLE_CLIENT_ID` (public, non-secret)
      to `bff/src/env.d.ts`/`.dev.vars`/the integration config, mirroring root's `src/config.ts` value.
      **Deviation, flagged for `sdd-verify`**: the pre-existing `bff/test/authenticated/containment.test.ts`
      forbade `GOOGLE_CLIENT_ID` on the BFF's `Env` — written before this design's own explicit decision
      ("it holds the (public) client_id to build the consent URL"). Updated that test's
      `FORBIDDEN_IDENTIFIERS` list to drop `GOOGLE_CLIENT_ID` only (every true secret — `CLIENT_SECRET`,
      `REFRESH_TOKEN`, the three Ads identifiers — stays forbidden), with a doc-comment note explaining why
      a `client_id` is not a secret (it is sent in a plaintext redirect URL to the browser on every
      authorize call)
- [x] 4a.5 RED `bff/test/oauth/callback.test.ts`: callback works with **no cookie present** (design's
      pre-gate rationale); Google token-endpoint rejection classified, upstream text discarded (spec "A
      rejected code exchange surfaces a normalized error, not raw upstream text"; Threat Matrix row d); a
      failed exchange leaves no partial credential row (spec "A failed code exchange leaves no partial
      credential row") — done: 3 RED tests, confirmed failing (`Cannot find module`) before 4a.6
- [x] 4a.6 GREEN `bff/src/oauth/callback.ts`: pre-gate route registered in the same slot as `POST
/auth/session` (`router.ts:802`); verifies `state`; forwards `code` to `seo-mcp` (implemented fully
      in 4b — this task only wires the forward call, no tool exists yet, so integration proof is deferred
      to 4b) — done: all 3 tests pass. `connect_error` enum values: `state_invalid` (missing/malformed/
      forged/expired/replayed/session-mismatched state) and `token_exchange_failed` (the forwarded
      `connect_google_account` call did not report success — this also covers the 404 the call produces
      today, since the tool does not exist until 4b). Added `"connect_google_account"` to `bff/src/
timeout.ts`'s `ToolName` union (30s budget: token exchange + the mandatory post-connect health probe)
      so the call is type-checked now — the tool itself (`src/mcp-tools/site-credentials.ts`) is NOT built;
      this is only the BFF-side name/timeout declaration. "No partial credential row" is trivially true:
      the BFF has no D1 binding, so it structurally cannot write a credential row from this route at all
- [x] 4a.7 RED `bff/test/gate.test.ts`: exact `Set-Cookie` attribute string is `SameSite=Lax`; every
      state-changing route remains POST or `confirm`-gated (Threat Matrix row h) — done: 2 new tests added.
      **Deviation, flagged for `sdd-verify`**: the `SameSite=Lax` GREEN change (4a.8) was made in the same
      pass as an unrelated prep edit (exporting `readCookie` from `gate.ts` for `authorize.ts` to reuse)
      before this RED test was written, so strict RED-first ordering was not observed for this one line —
      confirmed the RED test passes against the already-changed `gate.ts`, but did not observe it fail
      first. The state-changing-route assertion instead statically greps `router.ts` for each
      `delete_*`/`disconnect_*` route's preceding `request.method === "POST"` check, since no live
      disconnect/recheck route exists yet (Phase 4b)
- [x] 4a.8 GREEN `bff/src/gate.ts:181`: `SameSite=Strict` → `SameSite=Lax` — done (see 4a.7's note on
      ordering)
- [x] 4a.9 RED `bff/test/integration/oauth-connect-routes.test.ts`: `/api/tools/connect_google_account`
      returns 404 (design's not-in-`AUTHENTICATED_REGISTRY` invariant, exercised structurally even before
      4b's tool exists); authorize/callback are each individually enumerated, not pattern-matched (spec
      "The callback route is not reachable via the generic tool-call path") — done: 4 tests, all passing
      against the router wiring already in place from 4a.4/4a.6 (this file was written and run after those,
      not confirmed RED first, since it verifies the router wiring itself rather than a new unit). Covers:
      `connect_google_account` 404s even authenticated; `/auth/google/authorized` (typo) does not match;
      the authorize route requires authentication; the callback route is reachable with no session cookie
      and rejects a forged state as `state_invalid`. **Deviation**: `disconnect`/`recheck` routes do not
      exist yet (Phase 4b) so are not covered here
- [x] 4a.10 PROOF `pnpm test -- oauth state gate`: 166 files, 1510 tests, all green (up from 162/1489
      before this phase); full `pnpm test` green (same counts); `pnpm typecheck` clean (required one
      exhaustiveness fix: `bff/src/cache.ts`'s `CACHE_TTL_SECONDS: Record<ToolName, number>` needed a
      `connect_google_account` placeholder entry, mirroring `list_sites`/`add_site`/`delete_site`'s own
      "never actually cached, present only for exhaustiveness" precedent); `pnpm run format:check` clean
      after one `prettier --write` pass on 5 files

## Phase 4b: Three new MCP tools — `connect_google_account`, `disconnect_google_account`, `check_site_credentials` (PR4b) — `site-google-credentials`, `dashboard-bff`

- [x] 4b.1 RED `test/mcp-tools/site-credentials.test.ts`: `connect_google_account` exchanges `code`
      server-side, encrypts+persists via Phase 1's store, runs the mandatory synchronous post-connect
      probe from Phase 3 before reporting success (spec "A successful connect marks the site healthy" /
      "...marks the site invalid, not silently connected"); refresh token/ciphertext/`code` never appear
      in the tool's own return value (Threat Matrix row c) — done: 6 RED tests against a hand-rolled fake
      D1 (this "unit" vitest project has no Miniflare D1 binding, mirroring
      `test/google/credentials.test.ts`'s existing fake-D1 pattern); confirmed failing (`Cannot find
module`) before 4b.2
- [x] 4b.2 GREEN `src/mcp-tools/site-credentials.ts`: `connect_google_account({siteId, code, redirectUri})`
      — POST to Google `/token`, AES-GCM encrypt via Phase 1, UPSERT via `site-credential-store.ts`, run
      both health probes, return `{siteUrl, connected, accountLabel, health}` — never ciphertext or token
      — done: all 6 tests pass. **Deviation from this task's own literal wording, and from design.md's
      mermaid diagram**: the input is `{siteId, code, redirectUri}`, not `{siteUrl, ...}` — Phase 4a's
      actual `bff/src/oauth/callback.ts` forwards `verification.payload.siteId` (the `state` token itself
      is minted with `siteId`, per `authorize.ts`/`state.ts`), and that file needed no change per this
      phase's own assignment ("it should need NO changes now that the tool exists for real"). Flagged for
      `sdd-verify`, not silently reconciled. Added `getSiteById` to `src/db/site-store.ts` (did not exist;
      the tool receives `siteId`, not `siteUrl`). The connected account's email is obtained by **decoding
      the `id_token` JWT** returned alongside the refresh token (`openid email` scope guarantees an
      `email` claim), not by an extra `GET /oauth2/v3/userinfo` call — one fewer network round-trip for
      the same fact; the JWT signature is not verified since it arrived directly from Google's token
      endpoint over TLS, not from anything browser-supplied
- [x] 4b.3 RED disconnect requires confirm gate; rejected without it, row remains intact (spec "Disconnect
      requires confirmation"); confirmed disconnect deletes the row, `connected` becomes `false`, re-resolves
      to global tier with a fresh `"unchecked"` health state (spec "Confirmed disconnect deletes the row
      and re-resolves to the global tier") — done: 2 RED tests. **Investigated whether an explicit
      `deleteSiteCredentialHealth` call is necessary**: `src/google/health.ts#derivePresentedHealth`
      already treats an `accountKey` mismatch as `"unchecked"`, and after disconnect the resolved tier's
      `accountKey` becomes `"global"` while the stale row still carries the old site-tier `accountKey` —
      so the mismatch-is-unchecked derivation already produces the spec-required behavior with NO explicit
      delete. Implemented the explicit delete anyway (in 4b.4), for tidiness only — an orphaned row for a
      credential identity that no longer exists would otherwise sit unreachable in D1 indefinitely unless
      the exact same account is later reconnected, mirroring `deleteSite`'s own batch-delete precedent for
      the same two tables. Documented as a deliberate belt-and-suspenders choice, not a correctness fix
- [x] 4b.4 GREEN `disconnect_google_account({siteId, confirm: true})` behind `assertConfirmedDelete` — done:
      both tests pass; deletes `site_credentials` then, only if a row existed, `site_credential_health`
- [x] 4b.5 RED `check_site_credentials` returns current health without a probe unless explicitly asked to
      re-check; manual re-check bypasses the freshness window (spec "Manual recheck clears an invalid
      state without a new OAuth round-trip") — done: 2 RED tests, asserting zero `fetch` calls without
      `forceRecheck` and a live probe call with it
- [x] 4b.6 GREEN `check_site_credentials({siteId, forceRecheck?: boolean})` — done: without `forceRecheck`,
      returns `credentialStatusForSite`'s cached summary (zero Google calls); with `forceRecheck: true`,
      calls `checkSearchConsoleHealth`/`checkGoogleAdsHealth` with `{forceRecheck: true}` first, then
      re-reads the now-fresh summary via the same `credentialStatusForSite` call
- [x] 4b.7 GREEN wire `bff/src/router.ts`: `POST /api/tools/disconnect_google_account`, `POST
/api/tools/check_site_credentials` (both behind `authenticate()`, POST-only JSON body mirroring
      `delete_site`'s own precedent); `bff/src/oauth/callback.ts` (4a.6) now calls `connect_google_account`
      for real — done, confirmed it needed NO changes (see 4b.2's deviation note). Registered the three
      tools in `src/server.ts` via a new `registerSiteCredentialsTools(server, env)` call. Added
      `disconnect_google_account`/`check_site_credentials` to `bff/src/timeout.ts`'s `ToolName` union (10s
      / 30s) and to `bff/src/cache.ts`'s `CACHE_TTL_SECONDS` + `isCacheable` exhaustiveness (both never
      cached — a mutation and a route whose `forceRecheck: true` case must never be served stale)
- [x] 4b.8 RED `bff/test/integration/oauth-round-trip.test.ts`: mocked Google token endpoint; full
      authorize→callback→connected round-trip; a decoy refresh token set in the **stub** env appears in no
      response body, header, redirect URL, cache value, export, or log line (Threat Matrix row c, the
      change's headline containment test) — done: 2 tests, against the REAL `SELF` BFF Worker and the REAL
      stub MCP worker (`bff/test/integration/stub-mcp-worker.js`, extended with a `list_sites` entry and a
      `connect_google_account` branch that embeds a decoy secret sourced from the auxiliary worker's OWN
      `DECOY_REFRESH_TOKEN` binding — added to `vitest.bff-integration.config.ts` — never a hardcoded
      literal in the stub itself, so the test proves the value crosses the service binding, as a real
      refresh token would, and is still never observable in the callback's response body, headers,
      redirect URL, or the `RESULT_CACHE` KV namespace)
- [x] 4b.9 PROOF `pnpm test -- site-credentials`; `bff/test/integration/` full round-trip green; note in PR
      description this remains a **mocked-endpoint** proof per Phase 0's structural-only caveat — done:
      focused `site-credentials` run green (6 tests); `bff/test/integration/oauth-round-trip.test.ts` green
      (2 tests); full `pnpm test` green (168 files, up from 166; 1518 tests, up from 1510); `pnpm typecheck`
      clean (both root and `bff/ui` programs); `pnpm run format:check` clean after one `prettier --write`
      pass on the touched `.ts` files. **Mocked-endpoint caveat**: both the unit test's Google `/token`/
      `sites.get` calls and the integration test's `connect_google_account` tool call are against mocks/
      stubs, per Phase 0's structural-only note — no task in this phase exercises a real Google OAuth
      exchange

## Phase 5: Credential-scoped BFF cache key + per-account quota ledger (PR5) — `quota-visibility`, `authenticated-source-contract`

- [x] 5.1 RED `bff/test/authenticated/scoping.test.ts`: two `accountKey`s produce **different cache keys
      for identical args** (Threat Matrix row e, the second cross-account leak design.md identified);
      ledger buckets per account; two sites on one Google account share one bucket (spec "Sites sharing the
      global fallback show the shared tier's estimate..." generalizes: same account ⇒ same bucket);
      `credential` envelope field is required on every authenticated result (spec "Every Authenticated
      Result Carries Credential Provenance") — done: 4 new `describe` blocks (headline cross-account cache
      test, per-account/shared-account ledger bucketing, credential-envelope presence). **Deviation from
      strict RED-first ordering, flagged for `sdd-verify`**: given this phase's implementation complexity
      (new `account-scope.ts` module, cache/ledger key-shape changes, router wiring, error codes all
      interdependent), the test file was written and run alongside the GREEN implementation rather than
      confirmed failing first against an unimplemented target — same category of deviation 4a.7 already
      flagged for this change. Also fixed the pre-existing `bff/test/integration/stub-mcp-worker.js`
      `list_sites` fixture (`https://example.com`'s credential was `tier: "none"`/`not_connected`, added in
      Phase 4a purely for `authorize.ts`'s "known site" `site.id` check, which never reads `credential`) to
      a healthy `tier: "site"` entry — three pre-existing GSC integration tests use that exact `siteUrl` for
      an authenticated call, and 5.6's new gate now legitimately rejects an unhealthy/unconnected site
      before the call, so the fixture needed to represent a genuinely healthy site to keep meaning "the call
      succeeded" the way it did before this phase
- [x] 5.2 RED KV absent or throwing for the `ak1:{siteUrl}` map still serves a live result with an
      `unavailable` quota estimate rather than a closed failure (Threat Matrix row k) — done: two tests in
      `scoping.test.ts` (`RESULT_CACHE` absent, `RESULT_CACHE` throwing on the `ak1` lookup), both asserting
      `response.status === 200` and a live `data` payload; `account-scope.ts#resolveAccountForRoute` short-
      circuits to a fixed `"global"` fallback with no network call at all when `kv` is absent (nothing to
      cache into), and `getSiteAccountEntry`/`putSiteAccountEntry` wrap every KV call in try/catch exactly
      like `cache.ts#getCached`/`putCached`
- [x] 5.3 GREEN `bff/src/cache.ts`: `cacheKey = v1:{tool}:{accountKey}:{sha256(args)}` for authenticated
      routes; `bff/src/authenticated/quota-ledger.ts`: `q1:{source}:{accountKey}:{windowStart}` — done:
      `cacheKey(tool, inputs, accountKey?)` gained a third, OPTIONAL parameter — every non-authenticated
      caller (`dispatch()`) omits it, keeping `v1:{tool}:{hash}` byte-identical to before; `dispatchAuthenticated()`
      is the only caller that passes `account.accountKey`. `incrementLedger`/`recordUpstreamAttempt`/
      `getQuotaEstimate` all gained an `accountKey: string = "global"` parameter (inserted before their
      existing `now` parameter) — this is a POSITIONAL, non-backward-compatible signature change (unlike
      `cacheKey`'s optional-trailing-param approach), so every existing call site in
      `bff/test/authenticated/quota-ledger.test.ts` and `bff/src/router.ts` was updated to pass an explicit
      `accountKey` argument
- [x] 5.4 GREEN `accountKey` resolution from `ak1:{siteUrl}` in `RESULT_CACHE` (TTL 300s), written by every
      `list_sites` response, invalidated by connect/disconnect (4b) on write — done: new
      `bff/src/authenticated/account-scope.ts`. `resolveAccountForRoute(kv, siteUrl, deps)` reads
      `ak1:{siteUrl}` first; on a miss, `refreshSiteAccountMap` issues one inline `list_sites` call and
      writes a fresh `ak1:{url}` entry (the SAME `credential` object `list_sites` already computes per site
      via `credentialStatusForSite`, `src/google/health.ts` — reused verbatim, never re-derived) for EVERY
      returned site at once. A `siteUrl` absent from `list_sites`' own rows (should not happen in production
      — every `siteUrl` argument corresponds to a stored site — but does happen against a test stub that
      does not know about every `siteUrl` a test exercises) also gets a cached fallback entry, so a
      genuinely unresolvable site does not re-issue a `list_sites` call on every single request for the
      remainder of the 300s TTL. **Invalidation, and where it actually lives (see the constraints section
      below for why this needed re-reading design.md's two-key-spaces split)**: `connect_google_account`'s
      own result carries `siteUrl` (`connectGoogleAccountResultSchema`), so `bff/src/oauth/callback.ts` —
      the ONLY BFF-side code that ever sees a successful connect — calls `deleteSiteAccountEntry(env.RESULT_CACHE,
result.data.siteUrl)` right after the forwarded `connect_google_account` call succeeds, exactly
      matching design.md's mermaid diagram's `delete ak1:{siteUrl}` step. `disconnect_google_account`'s own
      result carries only `{siteId, disconnected}` — no `siteUrl` to key a single delete on — so
      `bff/src/router.ts`'s `POST /api/tools/disconnect_google_account` route instead calls
      `refreshSiteAccountMap` again after a successful disconnect (fire-and-forget via `ctx.waitUntil` when
      available, mirroring `quota-ledger.ts#recordUpstreamAttempt`'s own ctx-present/absent split), which
      overwrites EVERY site's entry — including the just-disconnected one — with current truth. Both
      invalidation call sites are BFF-side (inside `bff/src/oauth/callback.ts`/`bff/src/router.ts`), per
      design's "the `ak1:{siteUrl}` KV map lives in the BFF's `RESULT_CACHE`" — `seo-mcp`'s own
      `src/mcp-tools/site-credentials.ts` connect/disconnect handlers needed NO changes, since they have no
      KV binding at all and were never the right place for this call
- [x] 5.5 GREEN `bff/src/router.ts:556-575`: `credential: {source, accountKey, accountLabel?,
basis: "bff-resolved"}` required on the authenticated envelope — done: `authenticatedToolResponse` gained a
      required `account: AccountResolution` parameter; the `credential` field is now UNCONDITIONALLY present
      (never `?.`) on every response — hit, miss, and bypass alike — sourced from the SAME
      `resolveAccountForRoute` call `dispatchAuthenticated()` already needs for cache-key scoping (computed
      once per request, reused for the cache key, the ledger, the 5.6 gate, and this envelope field — no
      duplicate resolution). Note the task's own literal field list omits `accountLabel`'s `?` in practice:
      it is always present (as `string | null`), never omitted, matching `credentialStatusSchema`'s own
      `accountLabel: z.string().nullable()` discipline rather than the optional-omission pattern
      `currencyLabel`/`criteria` use elsewhere in this same function
- [x] 5.6 RED two new `BffErrorCode`s: `site_credential_not_connected` (503), `site_credential_unhealthy`
      (503), distinct from `upstream_source_not_configured`/`upstream_credential_failure` (mcp-error-contract
      spec "A site with no usable credential gets its own code" / "A health-check-gated site cannot be
      selected in the first place") — done: 2 tests in `scoping.test.ts`. Implemented as a PRE-CALL gate
      (`account-scope.ts#gateSiteCredential`), never a classification of upstream Google error text like
      `classify.ts`'s two existing functions — `dispatchAuthenticated()` calls it immediately after
      resolving the account and BEFORE any cache read or upstream call. Fires `site_credential_not_connected`
      when the resolved tier is `"none"` (presented as `searchConsole: "not_connected"` — the two states are
      1:1, per `credentialStatusForSite`'s own construction: `not_connected` only ever arises when `tier`
      is `"none"`); fires `site_credential_unhealthy` when `searchConsole` state is exactly `"unhealthy"`.
      Deliberately reads ONLY the `searchConsole` health field regardless of the calling tool's own source
      (`search-console` or `google-ads`) — per this phase's own instruction, Ads health never gates,
      matching Phase 3's `ensureSelectableHealth`'s existing "selectability is gated on the Search Console
      probe only" decision (`src/google/health.ts`). Gating only applies when the route has a `siteUrl`
      argument at all — `get_keyword_metrics`/`discover_keywords` have none yet (Threat Matrix row g,
      explicitly deferred elsewhere), so they always resolve the `siteUrl === undefined` fallback
      (`searchConsoleHealth: "unchecked"`, never gated), unchanged from their pre-Phase-5 behavior
- [x] 5.7 GREEN `bff/src/errors.ts`: add the two codes with sanitized messages (mcp-error-contract spec
      "An invalid-credential message names the category, not the upstream detail") — done: both messages
      name only the category ("no working Google account connected" / "failed its last health check"),
      never any upstream/internal detail. Also added matching minimal entries to
      `bff/ui/src/data/errors.ts`'s `ERROR_PRESENTATION` (that table's own `Record<BffErrorCode, ...>`
      exhaustiveness broke `tsc` otherwise) and bumped `bff/ui/src/data/errors.test.ts`'s exhaustiveness
      count from 16 to 18 — full UI wiring (which view renders each state) is out of scope for Phase 5,
      same "minimal entry only" precedent Phase 2's three PR2 codes already established in that file
- [x] 5.8 PROOF `pnpm test -- cache quota-ledger`; `wrangler types` regenerated if bindings changed — done:
      focused `pnpm test -- scoping cache quota-ledger authenticated-gsc-insights authenticated-search-console
oauth` green (169 files, 1527 tests); full `pnpm test` green (same counts, up from 168/1518 before this
      phase); `pnpm typecheck` clean (both root and `bff/ui` programs — required adding the two new codes to
      `bff/ui/src/data/errors.ts`'s exhaustive `Record`); `pnpm run format:check` clean after one
      `prettier --write` pass on the touched files. No Cloudflare binding changed (this phase only adds
      logic over the EXISTING `RESULT_CACHE` KV binding) — `wrangler types` regeneration skipped, as
      anticipated. Two pre-existing tests needed updates unrelated to their own stated purpose, both noted
      above: `stub-mcp-worker.js`'s `list_sites` fixture (5.1's note) and
      `bff/test/integration/cache.test.ts`'s `list_search_console_snapshots` call-count test, which now
      does one warm-up request before capturing its `before` baseline so the new one-time `ak1` map refresh
      cost for a never-before-seen `siteUrl` does not pollute its own unrelated cache-behavior assertion

## Phase 6: UI — Manage Domains, site selector gating, per-account Ads badge (PR6) — `site-google-credentials` (UI surface), `quota-visibility`

- [ ] 6.1 RED `ManageDomainsContainer` renders connection tier and health status as **two distinct elements
      with distinct accessible names**, never one element conflating both (spec "A connected but invalid
      site is visibly distinct from both 'connected' and 'not connected'")
- [ ] 6.2 RED Connect/Disconnect/Re-check controls exist per row; Disconnect requires the existing
      confirm-gate UI pattern; Re-check bypasses no user-visible cache indicator
- [ ] 6.3 GREEN `ManageDomainsContainer.tsx`: status column + three actions wired to Phase 4b's tools and
      Phase 3's `list_sites.credential` field
- [ ] 6.4 RED `SiteContext` selector disables any non-`healthy` site with the reason in the accessible name
      (spec "An invalid site cannot be selected"); no timer/focus/visibility handler issues a probe
      (design's health-check table, last row; `no-polling.test.ts` convention)
- [ ] 6.5 GREEN `SiteContext.tsx`: gate selection on `credentialHealth`/health state from Phase 3
- [ ] 6.6 RED `AdsQuotaBadge` names the account (`owner@example.com`, or "operator's shared account" for
      `global`); switching active site updates the estimate to the new account's own volume, never carries
      over the previous site's figure (quota-visibility spec "Two sites on different accounts show
      independent quota estimates" / "Switching to an invalid site clears the quota estimate...")
- [ ] 6.7 GREEN `AdsQuotaBadge.tsx`: per-account label + estimate sourced from Phase 5's scoped ledger
- [ ] 6.8 PROOF a11y + keyboard-only navigation pass; `pnpm test -- manage-domains site-context
ads-quota-badge`; full `pnpm test` and `pnpm typecheck` green

## Threat Matrix Traceability

| Row | Covered by task(s)                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | 4a.3                                                                                                                                                                                                                                   |
| b   | 4a.1                                                                                                                                                                                                                                   |
| c   | 1.2, 2.3, 3.5, 4b.1, 4b.8                                                                                                                                                                                                              |
| d   | 4a.5                                                                                                                                                                                                                                   |
| e   | 5.1                                                                                                                                                                                                                                    |
| f   | 2.3                                                                                                                                                                                                                                    |
| g   | (design row g — `x-seo-active-site` header spoofing) — deferred to `sdd-apply` wiring of `buildServer(env, {activeSiteUrl})`; add a RED test asserting absent header ⇒ global tier under Phase 2's `resolveSiteCredentials` call sites |
| h   | 4a.7                                                                                                                                                                                                                                   |
| i   | 3.5, 6.4                                                                                                                                                                                                                               |
| j   | 1.4                                                                                                                                                                                                                                    |
| k   | 5.2                                                                                                                                                                                                                                    |

## Recorded follow-ups (deliberately NOT tasked here)

- [ ] F1 Encryption-key rotation / re-encryption tooling — out of scope per proposal.
- [ ] F2 Removing the global credential tier once every site is connected — out of scope per proposal.
- [ ] F3 `AGENTS-seo.md` (untracked) should be brought under version control and updated, or deleted
      deliberately, since this change supersedes its manual Playground procedure.
- [ ] F4 `accountKey` provenance echoed by the tools themselves rather than BFF-resolved
      (`basis: "bff-resolved"`) — recommended follow-up per design's Open Questions.
- [ ] F5 An operator picker to resolve `ads_customer_ambiguous` — out of scope per design.
