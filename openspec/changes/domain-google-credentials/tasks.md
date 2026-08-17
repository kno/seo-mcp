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

- [ ] 2.1 RED `test/google/credentials.test.ts`: site-tier resolves entirely site fields, `credentialSource:
"site"` (spec "A connected site resolves to its own credentials"); global fallback resolves entirely
      global fields, `credentialSource: "global"` (spec "An unconnected site falls back to the global
      tier"); tiers never mix (spec "Tiers are never mixed"); neither tier usable ⇒
      `credentialSource: "none"`, no partial-set call attempted (spec "Neither tier has usable
      credentials"); literal `"Google credentials are not configured"` still thrown verbatim when
      resolution has nothing to report
- [ ] 2.2 GREEN `src/google/credentials.ts`: `GoogleOAuthCredentials`, `ResolvedCredential`,
      `resolveSiteCredentials(env, siteUrl)`, `credentialKey`/`accountKey` derivation exactly per design's
      two-key-space table
- [ ] 2.3 RED `test/google/auth.test.ts`: **two credential sets never share a cached access token**
      (headline test, Threat Matrix row f); expiry eviction; bound at `MAX_CACHED_TOKENS = 8`;
      `credentialKey` differs when only `refresh_token` differs; a RED test asserts no response/log/cache
      value contains a `credentialKey`-shaped value (Threat Matrix row c)
- [ ] 2.4 GREEN `src/google/auth.ts`: narrow `getGoogleAccessToken(credentials, fetcher?, now?)` signature;
      `Map<credentialKey, {token, expiresAtMs}>` keyed cache, bounded eviction; `resetGoogleTokenCache()`
      kept for tests
- [ ] 2.5 GREEN ripple: `src/google/search-console.ts:30` (`searchConsoleQuery(params, credentials, ...)`
      replaces `env`); `src/google/ads.ts:71` (`adsPost(env, credentials, ...)` keeps `env` for
      app-level developer-token/customer-ID fallback); `src/google/business.ts:37` calls
      `globalCredentials(env)`, otherwise unchanged
- [ ] 2.6 PROOF `test/integration/`: behavior-identical round-trip for every call site while no
      `site_credentials` row exists anywhere — this slice alone closes the cross-account token-cache leak
      (proposal Risk table row 1); `pnpm test -- credentials auth` green

## Phase 3: Health probes + state machine + `list_sites` status (PR3) — `site-google-credentials`

- [ ] 3.1 RED `test/google/health.test.ts`: `sites.get` probe classifies `permissionLevel:
"siteUnverifiedUser"` ⇒ `unhealthy(property_unverified)` (spec-equivalent "invalid" state);
      `listAccessibleCustomers` zero customers ⇒ `unhealthy(ads_no_accessible_customer)`; more than one ⇒
      `unhealthy(ads_customer_ambiguous)`; transport error/timeout ⇒ `unhealthy(probe_failed)` with a 60s
      `expires_at`, not the 6h TTL
- [ ] 3.2 GREEN `src/google/health.ts`: `sites.get` + `listAccessibleCustomers` probes; reason/detail
      derivation exactly per design's table; never includes credential material in `detail`
- [ ] 3.3 RED state-machine table: connect-time probe runs synchronously before "connected" is reported
      (spec "A successful connect marks the site healthy" / "...marks the site invalid, not silently
      connected"); selection-time probe runs only when cached record is absent/stale/tier-mismatched (spec
      "A fresh, healthy cached result is reused..." / "A stale cached result triggers a fresh probe..." /
      "A tier change invalidates the cached result even if it is fresh"); manual re-check bypasses the TTL
      (spec "Manual recheck clears an invalid state..."); listing never probes (spec "Listing sites never
      triggers a probe", Threat Matrix N/A-adjacent but load-bearing for cost); `checking` is never
      persisted; a real call's success extends `expires_at`, a real call's `upstream_credential_failure`
      directly downgrades without a probe
- [ ] 3.4 GREEN state-machine implementation wiring `site-credential-store.ts` health rows into the
      resolution path; `accountKey` drift on the health row invalidates a `healthy` result (spec "A tier
      change invalidates the cached result even if it is fresh")
- [ ] 3.5 RED `test/schemas/sites.test.ts`: `list_sites` gains `credential: { tier, accountLabel,
accountKey, health: { searchConsole, googleAds } }`; zero Google calls when serving the list (spec
      "Listing sites never triggers a probe"); never exposes ciphertext, IV, `credentialKey`, or plaintext
      (spec "No raw credential value ever appears in the list schema")
- [ ] 3.6 GREEN `src/schemas/sites.ts`: extend output schema; `src/server.ts` `list_sites` registration
      unchanged input, additive output only
- [ ] 3.7 PROOF `pnpm test -- health credentials`; `test/integration/` confirms `list_sites` round-trips the
      new field with no secret leak (Threat Matrix row c, i)

## Phase 4a: BFF OAuth routes + `state` token + `gate.ts` `Lax` (PR4a) — `google-account-connect-flow`, `dashboard-bff`

- [ ] 4a.1 RED `bff/test/oauth/state.test.ts`: forged signature rejected; replay (nonce already consumed)
      rejected; expired rejected; session-`sub` mismatch rejected; `siteId` tampering rejected (spec
      "A tampered state is rejected" / "A session-mismatched state is rejected" / "A replayed state is
      rejected on its second use" / "An expired state is rejected"; Threat Matrix row b)
- [ ] 4a.2 GREEN `bff/src/oauth/state.ts`: `HMAC-SHA-256` over `v1:oauth-state|{siteId}|{sub}|{nonce}|{exp}`
      keyed by new `GOOGLE_OAUTH_STATE_KEY` secret; single-use via `GET`+`DELETE` of `oauth-state:{nonce}`
      in KV, TTL 600s
- [ ] 4a.3 RED `bff/test/oauth/authorize.test.ts`: unauthenticated request rejected before any KV write or
      redirect, no `state` minted (Threat Matrix row a); unknown `siteUrl` rejected before mint/redirect
      (spec "An authorize request for an unknown site is rejected before redirecting")
- [ ] 4a.4 GREEN `bff/src/oauth/authorize.ts`: behind `authenticate()`; mints `state`; redirects to Google
      with `access_type=offline&prompt=consent` and the three scopes design specifies
- [ ] 4a.5 RED `bff/test/oauth/callback.test.ts`: callback works with **no cookie present** (design's
      pre-gate rationale); Google token-endpoint rejection classified, upstream text discarded (spec "A
      rejected code exchange surfaces a normalized error, not raw upstream text"; Threat Matrix row d); a
      failed exchange leaves no partial credential row (spec "A failed code exchange leaves no partial
      credential row")
- [ ] 4a.6 GREEN `bff/src/oauth/callback.ts`: pre-gate route registered in the same slot as `POST
/auth/session` (`router.ts:802`); verifies `state`; forwards `code` to `seo-mcp` (implemented fully
      in 4b — this task only wires the forward call, no tool exists yet, so integration proof is deferred
      to 4b)
- [ ] 4a.7 RED `bff/test/gate.test.ts`: exact `Set-Cookie` attribute string is `SameSite=Lax`; every
      state-changing route remains POST or `confirm`-gated (Threat Matrix row h)
- [ ] 4a.8 GREEN `bff/src/gate.ts:181`: `SameSite=Strict` → `SameSite=Lax`
- [ ] 4a.9 RED `bff/test/integration/`: `/api/tools/connect_google_account` returns 404 (design's
      not-in-`AUTHENTICATED_REGISTRY` invariant, exercised structurally even before 4b's tool exists);
      authorize/callback/disconnect/recheck are each individually enumerated, not pattern-matched (spec
      "The callback route is not reachable via the generic tool-call path")
- [ ] 4a.10 PROOF `pnpm test -- oauth state gate`; `pnpm test` green

## Phase 4b: Three new MCP tools — `connect_google_account`, `disconnect_google_account`, `check_site_credentials` (PR4b) — `site-google-credentials`, `dashboard-bff`

- [ ] 4b.1 RED `test/mcp-tools/site-credentials.test.ts`: `connect_google_account` exchanges `code`
      server-side, encrypts+persists via Phase 1's store, runs the mandatory synchronous post-connect
      probe from Phase 3 before reporting success (spec "A successful connect marks the site healthy" /
      "...marks the site invalid, not silently connected"); refresh token/ciphertext/`code` never appear
      in the tool's own return value (Threat Matrix row c)
- [ ] 4b.2 GREEN `src/mcp-tools/site-credentials.ts`: `connect_google_account({siteUrl, code, redirectUri})`
      — POST to Google `/token`, AES-GCM encrypt via Phase 1, UPSERT via `site-credential-store.ts`, run
      both health probes, return `{siteUrl, connected, accountLabel, health}` — never ciphertext or token
- [ ] 4b.3 RED disconnect requires confirm gate; rejected without it, row remains intact (spec "Disconnect
      requires confirmation"); confirmed disconnect deletes the row, `connected` becomes `false`, re-resolves
      to global tier with a fresh `"unchecked"` health state (spec "Confirmed disconnect deletes the row
      and re-resolves to the global tier")
- [ ] 4b.4 GREEN `disconnect_google_account({siteId, confirm: true})` behind `assertConfirmedDelete`
- [ ] 4b.5 RED `check_site_credentials` returns current health without a probe unless explicitly asked to
      re-check; manual re-check bypasses the freshness window (spec "Manual recheck clears an invalid
      state without a new OAuth round-trip")
- [ ] 4b.6 GREEN `check_site_credentials({siteId})`
- [ ] 4b.7 GREEN wire `bff/src/router.ts`: `POST /api/tools/disconnect_google_account`, `POST
/api/tools/check_site_credentials` (both behind `authenticate()`); `bff/src/oauth/callback.ts` (4a.6)
      now calls `connect_google_account` for real
- [ ] 4b.8 RED `bff/test/integration/oauth-round-trip.test.ts`: mocked Google token endpoint; full
      authorize→callback→connected round-trip; a decoy refresh token set in the **stub** env appears in no
      response body, header, redirect URL, cache value, export, or log line (Threat Matrix row c, the
      change's headline containment test)
- [ ] 4b.9 PROOF `pnpm test -- site-credentials`; `bff/test/integration/` full round-trip green; note in PR
      description this remains a **mocked-endpoint** proof per Phase 0's structural-only caveat

## Phase 5: Credential-scoped BFF cache key + per-account quota ledger (PR5) — `quota-visibility`, `authenticated-source-contract`

- [ ] 5.1 RED `bff/test/authenticated/scoping.test.ts`: two `accountKey`s produce **different cache keys
      for identical args** (Threat Matrix row e, the second cross-account leak design.md identified);
      ledger buckets per account; two sites on one Google account share one bucket (spec "Sites sharing the
      global fallback show the shared tier's estimate..." generalizes: same account ⇒ same bucket);
      `credential` envelope field is required on every authenticated result (spec "Every Authenticated
      Result Carries Credential Provenance")
- [ ] 5.2 RED KV absent or throwing for the `ak1:{siteUrl}` map still serves a live result with an
      `unavailable` quota estimate rather than a closed failure (Threat Matrix row k)
- [ ] 5.3 GREEN `bff/src/cache.ts`: `cacheKey = v1:{tool}:{accountKey}:{sha256(args)}` for authenticated
      routes; `bff/src/authenticated/quota-ledger.ts`: `q1:{source}:{accountKey}:{windowStart}`
- [ ] 5.4 GREEN `accountKey` resolution from `ak1:{siteUrl}` in `RESULT_CACHE` (TTL 300s), written by every
      `list_sites` response, invalidated by connect/disconnect (4b) on write
- [ ] 5.5 GREEN `bff/src/router.ts:556-575`: `credential: {source, accountKey, accountLabel?,
basis: "bff-resolved"}` required on the authenticated envelope
- [ ] 5.6 RED two new `BffErrorCode`s: `site_credential_not_connected` (503), `site_credential_unhealthy`
      (503), distinct from `upstream_source_not_configured`/`upstream_credential_failure` (mcp-error-contract
      spec "A site with no usable credential gets its own code" / "A health-check-gated site cannot be
      selected in the first place")
- [ ] 5.7 GREEN `bff/src/errors.ts`: add the two codes with sanitized messages (mcp-error-contract spec
      "An invalid-credential message names the category, not the upstream detail")
- [ ] 5.8 PROOF `pnpm test -- cache quota-ledger`; `wrangler types` regenerated if bindings changed

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
