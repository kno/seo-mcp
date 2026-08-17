# Design: Per-Domain Google Credentials via "Connect Google Account"

## Technical Approach

Two facts read from source this session redirect the proposal's shape, and both are load-bearing:

| Verified fact                                                                                                                                     | Evidence                                                        | Consequence                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The BFF has **no D1 binding** — only `SEO_MCP` (service) and `RESULT_CACHE` (KV). D1 is bound exclusively to `seo-mcp`.                            | `bff/wrangler.jsonc:6-20` vs `wrangler.jsonc:22-29`             | The BFF **cannot** write the credential row. Encryption, storage and the KEK all stay in `seo-mcp`; `bff/src/crypto/` is **not** created (proposal deviation, see below). |
| The session cookie is `SameSite=Strict`.                                                                                                          | `bff/src/gate.ts:181`                                           | Google's cross-site 302 to our callback carries **no cookie**. A callback placed behind `authenticate()` returns `gate_unauthorized` 100% of the time.                   |
| `/mcp` is the only route on `seo-mcp`; every other path is a hard 404.                                                                             | `src/index.ts:15-16`                                            | Any BFF→`seo-mcp` credential operation must be an **MCP tool**, not a new HTTP route.                                                                                    |
| `authenticate()` runs at `handleRequest`'s top, but `POST /auth/session` is enumerated **before** it.                                              | `bff/src/router.ts:802-808`                                     | Precedent already exists for a pre-gate, self-authorizing route. The OAuth callback reuses that exact slot.                                                              |
| `getGoogleAccessToken` caches in an **unkeyed module-level variable**; all three call sites pass the whole `Env`.                                  | `src/google/auth.ts:3,9-13`; `search-console.ts:30`; `ads.ts:71` | Keying is mandatory here, not deferred.                                                                                                                                 |
| The BFF cache key is `sha256(canonicalJson(args))` with no credential scope; `get_keyword_metrics`/`discover_keywords` take **no `siteUrl` arg**. | `router.ts:639`; `src/google/ads.ts:127-132`                    | Without a credential-scoped key, account A's keyword metrics are served from cache to account B. **Second cross-account leak, distinct from the token cache.**            |
| `classifyUpstreamFailure` exact-matches `"Google credentials are not configured"`.                                                                 | `bff/src/authenticated/classify.ts:33`                          | That literal is a contract. `src/google/auth.ts` MUST keep throwing it verbatim.                                                                                         |

So the change is **three concentric rings**, each independently revertable:

1. **`seo-mcp` owns all credential material** — D1 storage, AES-GCM, the KEK, the code exchange, the health probes, and the keyed token cache. Nothing in `bff/src` can serialize a refresh token, because none is in scope there. This preserves `dashboard-insights`' structural containment decision ("absence beats redaction") rather than replacing it with redaction discipline.
2. **The BFF owns the redirect round-trip only** — it holds the (public) `client_id` to build the consent URL, mints/verifies the `state` token, and forwards the single-use `code` to `seo-mcp`. It never holds a client secret or a refresh token, so an authorization code is the strongest thing it can leak, and a code is unredeemable without the secret it does not have.
3. **The UI reads two orthogonal facts per site** — connection tier and health state — never conflated.

## Architecture Decisions

### Decision: the code exchange happens in `seo-mcp`, not the BFF

| Option                                                                          | Cost                                                                                                                     | Decision                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| BFF gets a D1 binding + the KEK; exchanges the code; encrypts and writes        | KEK in two Workers, refresh token in BFF memory, D1 in two Workers — triples the blast radius and voids containment tests | **Rejected**                                                                    |
| BFF exchanges the code, ships the raw refresh token to `seo-mcp` as a tool arg  | Plaintext refresh token crosses the service boundary and sits in BFF memory for no benefit                               | **Rejected**                                                                    |
| **BFF forwards the `code`; `seo-mcp` exchanges, encrypts, stores, probes**      | One extra hop; the callback's latency includes the token exchange + probe (~1s)                                           | **Chosen** — BFF never sees a refresh token or a client secret at any instant |

### Decision: the callback is pre-gate and authorized by the `state` token; the cookie becomes `SameSite=Lax`

Both are needed, for two different requests.

| Problem                                                                            | Fix                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google→`/auth/google/callback` carries no `Strict` cookie                          | Enumerate the callback **before** `authenticate()`, in the same slot `POST /auth/session` already occupies (`router.ts:802`). Its authorization is the signed, single-use, session-bound `state`, not the cookie. |
| The callback's own 302 back to the SPA is still inside a cross-site redirect chain, so the landing page load also has no cookie → user lands on the login screen after a successful connect | `SameSite=Strict` → `SameSite=Lax` in `gate.ts:181`.                                                                                                                                      |

**Why `Lax` is not a real regression here**: `Lax` withholds the cookie from cross-site **POST** navigations, and every state-changing route in this BFF is POST (`/api/tools/delete_site`, `delete_*_snapshot`, `analyze_pagespeed`) or requires `confirm: true`. What `Strict` uniquely blocked was cross-site top-level **GET** navigations — all of which are reads here. **Alternative rejected**: keeping `Strict` and having the callback return a 200 HTML shim that performs a same-site `location.replace()` — it works, but it introduces the only hand-written HTML-in-Worker surface in the repo for a CSRF property that is not load-bearing on any GET route.

### Decision: one app OAuth client, N refresh tokens — no per-site `client_secret`

The connect flow reuses the existing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (already a "Web application" client per `AGENTS-seo.md`) as the **app's** client, with the deployed callback added to its authorized redirect URIs. Each connected Google account contributes only a refresh token.

**Proposal deviation, deliberate**: the proposal's schema stored an encrypted per-site `client_secret`. It is dropped. A refresh token is only redeemable by the client that minted it, so a per-site secret is either identical to the app's secret (pure duplication of the highest-value secret across N rows) or implies a bring-your-own-OAuth-client feature nobody asked for. `client_id` **is** still stored per row — it records which client minted the token, which the token-cache key and any future client rotation both need. Encrypted-field count drops from two to one.

Scopes requested: `openid email`, `https://www.googleapis.com/auth/webmasters.readonly`, `https://www.googleapis.com/auth/adwords`, with `access_type=offline&prompt=consent` so a refresh token is guaranteed even on re-consent.

### Decision: two key spaces, never interchangeable

| Key             | Derivation                                                    | Used for                                                        | Exposed to browser |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------- | ------------------ |
| `credentialKey` | `base64url(sha256(client_id \| "\0" \| refresh_token))[0..22]` | The keyed token cache in `src/google/auth.ts` **only**           | **Never**          |
| `accountKey`    | `base64url(sha256(client_id \| "\0" \| lower(email)))[0..22]`, or the literal `"global"` | Quota ledger bucket, BFF cache-key scope, health-row identity, UI grouping | Yes — safe         |

`credentialKey` is secret-derived and never leaves `seo-mcp`; `accountKey` is derived from an already-displayed email and is safe on the wire. Deriving one from the other is forbidden — a RED test asserts no response body contains a `credentialKey`-shaped value. `accountKey` correctly collapses **multiple sites sharing one Google account into one quota bucket**, which is the grouping the user asked for (quota is per OAuth client/project, not per site).

### Decision: the health check is lazy-cached with event-driven invalidation, never polled

| When                                                                                     | Runs a probe? | Rationale                                                             |
| ---------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------- |
| Connect callback, synchronously, before the site is reported connected                   | **Yes**       | A connect that reports success without proving access is a lie        |
| Selection attempt where the cached record is absent or `expires_at <= now`                | **Yes**       | A click is a `UserIntent`; one `sites.get` is ~100ms                  |
| Selection attempt where the record is fresh and `healthy`                                | No            | Zero latency on the common path                                       |
| Explicit "Re-check" button in Manage Domains                                             | **Yes**       | Operator escape hatch after fixing permissions at Google              |
| Any real data call that classifies to `upstream_credential_failure`                      | No probe — **direct downgrade** to `unhealthy(credential_rejected)` | A failed real call is stronger evidence than a probe |
| Any successful authenticated data call for the same `(site, source, accountKey)`          | No probe — **extends `expires_at`** | A successful real call is stronger evidence than a probe |
| A timer, focus, or visibility event                                                      | **Never**     | `no-polling.test.ts` |

TTL: `CREDENTIAL_HEALTH_TTL_SECONDS = 21600` (6h), matching `AUTH_SOURCE_TTL_SECONDS.closed`'s existing convention. **Alternatives rejected**: probe on every selection (spends a Google call per UI click for a fact that changes monthly); probe on connect only (a revoked token or removed property permission would read `healthy` forever); a cron re-check (the only cron is weekly, `wrangler.jsonc:20` — far too slow to be the primary mechanism, and redundant given event-driven downgrade).

**Probe calls — cheapest that proves real access:**

| Source           | Probe                                                                          | Why this one                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search-console` | `GET /webmasters/v3/sites/{siteUrl}` (`sites.get`)                             | Cheapest call that is **property-scoped**, and it returns `permissionLevel`. `siteUnverifiedUser` means "listed but no data" → must be `unhealthy`, which a bare `sites.list` cannot distinguish and a `searchAnalytics.query` only reveals as an empty result. |
| `google-ads`     | `GET /v23/customers:listAccessibleCustomers`                                   | Needs no customer ID (so it works before we know one), proves the developer token + refresh token combination works, and **resolves `ads_customer_id`** as a side effect.  |

### Decision: selectability is gated on the Search Console probe only; Ads health is a separate non-gating status

Google Ads has no per-site notion at all (`src/google/ads.ts` takes only `customerId`), so an Ads probe can never prove "access to *this site's* data". Blocking a whole site's dashboard because Keyword Planner is not enabled would make eleven working views unreachable for a keyword-research failure. Ads health is therefore stored and displayed per `(site, "google-ads")` but does not affect selectability; the Ads tools surface `upstream_source_not_configured` on their own when Ads is unhealthy. **This refines the user's directive** — flagged, not assumed silently.

`listAccessibleCustomers` returning zero customers → `unhealthy(ads_no_accessible_customer)`. Returning more than one → `unhealthy(ads_customer_ambiguous)`; the design **does not guess** which account to bill. Resolving ambiguity (an operator picker) is out of scope.

### Decision: two persisted health states, five presented states, `checking` never persisted

Persisted `state` is exactly `healthy | unhealthy`. Everything else is **derived**:

```
not_connected : no site_credentials row AND no global env tier          -> not selectable
unchecked     : credentials resolve, no health row (or accountKey drift) -> not selectable
stale         : health row with expires_at <= now                        -> not selectable, probe on next attempt
checking      : probe in flight — RESPONSE/UI state only, never in D1    -> not selectable
healthy       : state=healthy AND expires_at > now                       -> SELECTABLE
unhealthy     : state=unhealthy (+ reason)                               -> not selectable
```

`checking` is deliberately not a persisted state: a Worker isolate can die mid-probe, and a persisted `checking` would strand a site permanently un-selectable with no actor left to clear it. `unhealthy(probe_failed)` (transport error / timeout) is written with a **60-second** `expires_at` instead of 6h — it is inconclusive, not evidence of a bad credential, so it fails closed for selectability but self-heals on the next attempt, and it is presented as "could not verify" rather than "verification failed".

`accountKey` is part of the health row's identity, so **health is a property of `(site, source, credential identity)`** — rotating the global env secrets or reconnecting a different Google account invalidates the row by mismatch rather than serving a stale verdict.

### Decision: the BFF cache key and quota ledger are credential-scoped via a KV site→account map

`cacheKey` becomes `v1:{tool}:{accountKey}:{sha256(args)}` for authenticated routes. Without this, `get_keyword_metrics` for `["seo tools"]` is a cache hit across two different Google accounts — a cross-account data leak through the cache, structurally identical to the token-cache bug and equally unfixed by keying only the token cache. The ledger becomes `q1:{source}:{accountKey}:{windowStart}`.

The BFF needs `accountKey` **before** the upstream call (the ledger increments on the attempt, not on success — `quota-ledger.ts` invariant 1). It resolves it from `ak1:{siteUrl}` in `RESULT_CACHE` (TTL 300s), written by every `list_sites` response and invalidated by the connect/disconnect routes. On a miss it issues one inline `list_sites` call — already characterised as a cheap local D1 read that spends no Google quota (`bff/src/cache.ts#isCacheable`, `ui/src/data/client.ts:159`). **Alternative rejected**: letting the browser send `accountKey` (the client would choose which quota bucket to spend, and which cache partition to read).

### Decision: provenance rides the BFF envelope, not sixteen output schemas

`credential: { source: "site" | "global", accountKey, accountLabel?, basis: "bff-resolved" }` becomes a **required** field on the authenticated envelope, alongside `sourceFreshness`/`quota`/`currencyLabel` (`router.ts:556-575`). The proposal implied a `credentialSource` field inside each tool result, which would mean editing all 16 registered authenticated output schemas — a request-facing MCP surface change flagged higher-risk by `openspec/config.yaml`, for a fact the BFF already resolved one line earlier.

Cost, stated honestly: the envelope value comes from the BFF's 300s-TTL map, not from the code path that actually chose the credential, so `basis: "bff-resolved"` labels it exactly like `"bff-observed"` labels the quota estimate. Divergence is only reachable if D1 is mutated outside the BFF (a direct MCP-host call) and converges within 300s. Having the tools echo the resolved `accountKey` themselves is the correct long-term answer and is a recommended follow-up — the same trajectory `dashboard-insights` recorded for server-side error codes.

### Decision: Ads binds to the active site via a transport header, not a new tool param

The user's constraint is "no new tool params" — but `seo-mcp` cannot resolve a credential it has no site for. Resolution: the BFF's `/api/tools/{get_keyword_metrics,discover_keywords}` routes accept `siteUrl` as their **own** (BFF-level, Zod-validated) input, do **not** forward it as a tool argument, and instead set `x-seo-active-site` on the `env.SEO_MCP.fetch` call. `src/index.ts` reads it and threads it into `buildServer(env, { activeSiteUrl })` — per-request closure state, not module-level mutable state (`openspec/config.yaml` apply rule). MCP tool input schemas are byte-unchanged, so no MCP host sees a new parameter, and a host that sends no header resolves the global tier exactly as today.

Authority note: setting that header requires `MCP_AUTH_TOKEN`, which already authorizes calling every site-scoped GSC tool — so it grants no capability a caller lacks. Recorded in the threat matrix, not hand-waved.

## Data Flow — connect round-trip (project rule: sequence diagram)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (Manage Domains)
  participant R as bff router.ts
  participant KV as RESULT_CACHE
  participant G as Google (accounts + APIs)
  participant M as seo-mcp /mcp
  participant D as D1 (seo-mcp only)
  B->>R: GET /auth/google/authorize?siteId=7   (behind authenticate(); session required)
  R->>KV: put oauth-state:{nonce} = {siteId, sub}  TTL 600s
  R-->>B: 302 accounts.google.com/o/oauth2/v2/auth?client_id&redirect_uri&scope&state=HMAC(v1:oauth-state|siteId|sub|nonce|exp)&access_type=offline&prompt=consent
  B->>G: consent screen (credentials only ever entered at Google)
  G-->>R: 302 /auth/google/callback?code&state   %% PRE-GATE route: no cookie arrives (SameSite)
  R->>R: verify state HMAC + exp; GET+DELETE oauth-state:{nonce} -> single use
  R->>M: callTool connect_google_account { siteUrl, code, redirectUri }  %% BFF holds NO client secret
  M->>G: POST /token (code exchange, client_secret from seo-mcp secrets)
  G-->>M: { refresh_token, access_token, id_token(email) }
  M->>M: AES-GCM encrypt(refresh_token, iv, aad="site:{id}:refresh_token")
  M->>D: UPSERT site_credentials(site_id, client_id, ciphertext, iv, email, account_key, scopes)
  M->>G: sites.get({siteUrl})  +  customers:listAccessibleCustomers   %% health probes
  M->>D: UPSERT site_credential_health x2 (healthy | unhealthy+reason)
  M-->>R: { siteUrl, connected: true, accountLabel, health: {...} }   %% never ciphertext, never token
  R->>KV: delete ak1:{siteUrl}   %% invalidate site->account map
  R-->>B: 302 /#/manage-domains?connected=1  (or ?connect_error={code}, fixed enum only)
  Note over R,B: No code, state, token, ciphertext or KEK in any body, header, cache value, export or log
```

**Read path**, per authenticated call: `dispatchAuthenticated` resolves `accountKey` from `ak1:{siteUrl}` → builds the credential-scoped cache key → increments `q1:{source}:{accountKey}:{window}` on the attempt → `seo-mcp` calls `resolveSiteCredentials(env, siteUrl)` (site row, else global) → `getGoogleAccessToken(credentials)` keyed by `credentialKey` → the Google call.

## Interfaces / Contracts

```ts
// src/google/credentials.ts (new)
export interface GoogleOAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}
export interface ResolvedCredential {
  readonly credentials: GoogleOAuthCredentials;
  readonly source: "site" | "global";
  readonly accountKey: string; // "global" for the env tier
  readonly accountLabel: string | null; // connected Google email; null for global
}
// Throws the VERBATIM "Google credentials are not configured" when neither tier
// resolves — `bff/src/authenticated/classify.ts:33` exact-matches that literal.
export function resolveSiteCredentials(
  env: Env,
  siteUrl: string | undefined,
): Promise<ResolvedCredential>;

// src/google/auth.ts — signature change, rippling to search-console.ts:30, ads.ts:71, business.ts:37
export function getGoogleAccessToken(
  credentials: GoogleOAuthCredentials,
  fetcher?: typeof fetch,
  now?: () => number,
): Promise<string>;
// Cache: Map<credentialKey, { token; expiresAtMs }>, MAX_CACHED_TOKENS = 8,
// evicting expired entries first then the oldest. `resetGoogleTokenCache()` kept
// for tests. `business.ts` calls `globalCredentials(env)` and is otherwise unchanged.
```

`searchConsoleQuery(params, credentials, fetcher?, now?)` replaces `env` outright. `adsPost(env, credentials, ...)` **keeps** `env` — the Ads developer token, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` and the customer-ID fallback are app-level, not per-account (`src/google/ads.ts:61-83`).

**D1 schema — `migrations/0004_site_credentials.sql`** (additive, `CREATE TABLE IF NOT EXISTS`, per the `0003_sites.sql` convention):

```sql
CREATE TABLE IF NOT EXISTS site_credentials (
  site_id                  INTEGER PRIMARY KEY,  -- 1:1 with sites.id
  client_id                TEXT NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,        -- base64, AES-GCM
  refresh_token_iv         TEXT NOT NULL,        -- base64, 12 random bytes PER WRITE
  google_account_email     TEXT NOT NULL,
  account_key              TEXT NOT NULL,
  ads_customer_id          TEXT,                 -- resolved by the Ads probe; NULL when absent/ambiguous
  scopes                   TEXT NOT NULL,
  connected_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_credentials_account ON site_credentials(account_key);

CREATE TABLE IF NOT EXISTS site_credential_health (
  site_id           INTEGER NOT NULL,
  source            TEXT NOT NULL,  -- 'search-console' | 'google-ads'
  credential_source TEXT NOT NULL,  -- 'site' | 'global'
  account_key       TEXT NOT NULL,  -- health is scoped to the credential IDENTITY
  state             TEXT NOT NULL,  -- 'healthy' | 'unhealthy' ONLY
  reason            TEXT,           -- credential_rejected | property_not_accessible |
                                    -- property_unverified | probe_failed |
                                    -- ads_no_accessible_customer | ads_customer_ambiguous
  detail            TEXT,           -- e.g. permissionLevel. NEVER credential material.
  checked_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  PRIMARY KEY (site_id, source)
);
```

A separate table (not columns on `sites`) for two independent reasons: the proposal's rollback plan requires never dropping the credential table, which is easier to honor as its own object; and **a globally-resolved site has a health record but no credential row**, so health cannot live on the credential row either. `deleteSite` becomes an explicit `db.batch([...])` deleting both child rows — **not** `ON DELETE CASCADE`, because that depends on D1's foreign-key PRAGMA state rather than on tested code.

**Encryption**: AES-GCM-256. KEK from a new `seo-mcp` secret `DOMAIN_CREDENTIAL_ENCRYPTION_KEY` (base64 of 32 random bytes), imported via `subtle.importKey("raw", …, { name: "AES-GCM" }, false, ["encrypt","decrypt"])` — the same `subtle.importKey` shape `bff/src/session.ts:52-63` already uses for HMAC. Random 12-byte IV per write. **`additionalData = "site:{site_id}:refresh_token"`**, so lifting site A's ciphertext onto site B's row fails to decrypt instead of silently succeeding. Key rotation is deferred per the proposal: losing the KEK makes every stored token undecryptable, every site reads as `unchecked`→`unhealthy(credential_rejected)`, and reconnection is required.

**New BFF routes** (explicitly enumerated; never pattern-matched):

| Route                                                   | Gate                                | Request                            | Response                                                       |
| ------------------------------------------------------- | ----------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `GET /auth/google/authorize`                            | behind `authenticate()`             | `?siteId={int}`                    | `302` to Google, or `bffError` (`invalid_input`/`gate_*`)       |
| `GET /auth/google/callback`                             | **pre-gate**, `state`-authorized    | `?code&state`                      | `302 /#/manage-domains?connected=1` \| `?connect_error={enum}`  |
| `POST /api/tools/disconnect_google_account`             | behind `authenticate()`             | JSON `{ siteId, confirm: true }`   | `BffOk<{ siteId, disconnected }>`                              |
| `POST /api/tools/check_site_credentials`                | behind `authenticate()`             | JSON `{ siteId }`                  | `BffOk<{ siteId, health }>`                                    |

`connect_google_account` is an MCP tool but is **not** in `AUTHENTICATED_REGISTRY` and **not** reachable at `/api/tools/connect_google_account` — a RED test asserts that path 404s. This introduces a third route class the allowlist must model: BFF-internal-only tools.

**`state` token**: `HMAC-SHA-256` over `v1:oauth-state|{siteId}|{sub}|{nonce}|{exp}` with a new `GOOGLE_OAUTH_STATE_KEY` secret (separate from `DASHBOARD_SESSION_KEY`; the version prefix additionally makes token confusion impossible). Single-use is enforced by `GET`+`DELETE` of `oauth-state:{nonce}` in KV, TTL 600s. KV is eventually consistent, so a sub-second replay is theoretically possible — bounded by the 10-minute expiry and backstopped by Google itself, which rejects an already-redeemed authorization code. Documented, not papered over.

**`list_sites` output** gains a `credential` object per site — `{ tier: "site" | "global" | "none", accountLabel: string | null, accountKey, health: { searchConsole: {...}, googleAds: {...} } }`. Zero Google calls: it reads only the cached health rows. **Never** ciphertext, IV, `credentialKey`, or plaintext.

**UI**: `ManageDomainsContainer` gains a Connect/Disconnect/Re-check column plus a **status column separate from the connection column** — the user's requirement that `unhealthy` is never conflated with "not yet connected". `SiteContext` disables non-`healthy` sites in the selector with the reason in the accessible name. `AdsQuotaBadge` becomes **"quota for the active site's account"**, its accessible name naming the account (`owner@example.com`, or "operator's shared account" for `global`). **Alternative rejected**: one badge per known account — the BFF would enumerate every account and read N KV keys on every response, to display headroom the operator cannot act on for a site they are not looking at.

## File Changes

| File                                                                            | Action        | Description                                                                                        |
| ------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `src/crypto/credential-cipher.ts`                                               | Create        | AES-GCM encrypt/decrypt + AAD binding. First encryption code in the repo.                          |
| `src/google/credentials.ts`                                                     | Create        | `GoogleOAuthCredentials`, `resolveSiteCredentials`, `accountKey`/`credentialKey` derivation         |
| `src/google/health.ts`                                                          | Create        | `sites.get` + `listAccessibleCustomers` probes; state/reason derivation                            |
| `src/db/site-credential-store.ts`                                               | Create        | `site_credentials` + `site_credential_health` read/write                                            |
| `migrations/0004_site_credentials.sql`                                          | Create        | Additive `CREATE TABLE IF NOT EXISTS` only                                                         |
| `src/mcp-tools/site-credentials.ts`                                             | Create        | `connect_google_account`, `disconnect_google_account`, `check_site_credentials`                     |
| `src/google/auth.ts`                                                            | Modify        | Narrow credential param; `Map` keyed on `credentialKey`, bounded at 8. **Higher risk: choke point** |
| `src/google/search-console.ts`, `src/google/ads.ts`, `src/google/business.ts`   | Modify        | Signature updates; `business.ts` keeps global credentials unconditionally                          |
| `src/index.ts`, `src/server.ts`                                                 | Modify        | `x-seo-active-site` → `buildServer(env, requestContext)`; register the three new tools             |
| `src/db/site-store.ts`                                                          | Modify        | `deleteSite` batch-deletes both child rows                                                         |
| `src/schemas/sites.ts`, `src/config.ts`                                         | Modify        | `credential` status shape; `DOMAIN_CREDENTIAL_ENCRYPTION_KEY`. Regenerate `Env` via `wrangler types` |
| `bff/src/oauth/{authorize,callback,state}.ts`                                   | Create        | Redirect routes + `state` mint/verify                                                              |
| `bff/src/router.ts`                                                             | Modify        | 4 new routes; `accountKey` resolution; credential-scoped cache key + ledger. **Higher risk: auth surface** |
| `bff/src/gate.ts`                                                               | Modify        | `SameSite=Strict` → `Lax` (one attribute, security-relevant, own RED test)                         |
| `bff/src/{cache,errors}.ts`, `bff/src/authenticated/quota-ledger.ts`            | Modify        | `accountKey` in cache key + ledger key; two new `BffErrorCode`s                                    |
| `bff/ui/src/containers/ManageDomainsContainer.tsx`, `app/SiteContext.tsx`, `molecules/AdsQuotaBadge.tsx` | Modify | Connect/Disconnect/Re-check, separate status column, selector gating, per-account badge |
| `src/http/*`, `src/security/*`, `src/pagespeed/*`, `bff/src/crypto/`            | **Unchanged / not created** | Drift is a scope escalation; `bff/src/crypto/` is superseded by `src/crypto/`           |

**New error codes**: `site_credential_not_connected` (503 — no account connected and no global tier) and `site_credential_unhealthy` (503 — resolved but failed its probe), both distinct from `upstream_source_not_configured` and `upstream_credential_failure` per the proposal's `mcp-error-contract` amendment.

## Testing Strategy (Strict TDD — RED first, `pnpm test`)

| Layer                               | What to test                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit `test/` (crypto)               | Round-trip; tampered ciphertext fails closed (no garbage); wrong key fails; **wrong AAD** (site B's row) fails; IV differs across two writes of the same plaintext                                                                                                                                                                                       |
| Unit `test/` (auth cache)           | **Two credential sets never share a cached token** (the headline RED test); expiry eviction; bound at 8 entries; `credentialKey` differs when only `refresh_token` differs; the literal `"Google credentials are not configured"` is still thrown verbatim                                                                                                |
| Unit `test/` (resolution + health)  | site tier wins; global fallback; tiers never mix (never site `client_id` + global `refresh_token`); every state transition in the table above; `permissionLevel: "siteUnverifiedUser"` ⇒ `unhealthy(property_unverified)`; `probe_failed` gets a 60s `expires_at`; `accountKey` drift invalidates a `healthy` row                                          |
| Unit `bff/test/` (state token)      | Replay rejected (nonce consumed); expired rejected; session-`sub` mismatch rejected; forged signature rejected; `siteId` tampering rejected                                                                                                                                                                                                              |
| Unit `bff/test/` (scoping)          | Two `accountKey`s produce **different cache keys for identical args** (the second cross-account leak); ledger buckets per account; two sites on one account share one bucket; `credential` envelope field is required                                                                                                                                     |
| Unit (view)                         | Connection tier and health status are **two distinct elements with distinct accessible names**, and no element contains both; a non-`healthy` site is disabled in the selector with its reason; Connect/Disconnect/Re-check exist per row; no timer/focus/visibility handler issues a probe                                                                |
| Integration `bff/test/integration/` | Mocked Google token endpoint (never a real Google call): full authorize→callback→connected round-trip; a decoy refresh token set in the **stub** env appears in no response body, header, redirect URL, cache value, export, or log line; `/api/tools/connect_google_account` 404s; the callback works with **no cookie present**; the `Set-Cookie` header is `SameSite=Lax` |
| Integration `test/integration/`     | The three new tools register with object-root `outputSchema`s; `list_sites` exposes `credential` with no secret field; a `business_*` call still resolves the global tier with no health check                                                                                                                                                            |

## Threat Matrix

Applicable boundaries: **HTTP routing** and **secret handling**. Explicit `N/A`: shell/subprocess invocation, VCS/PR automation, executable-file classification, documentation-path classification, process integration — this change adds none of them.

| # | Applicable row                                                                          | Expected behavior / RED test                                                                                                                            |
| - | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a | Unauthenticated `GET /auth/google/authorize`                                            | `gate_unauthorized` before any KV write or redirect; no `state` is minted                                                                                |
| b | Callback with forged / replayed / expired / `sub`-mismatched `state`                     | Rejected before `connect_google_account` is called; no D1 write; a fixed `connect_error` enum value, never upstream text                                 |
| c | No credential material in any egress                                                    | Refresh token, ciphertext, IV, KEK, client secret, `code`, and `credentialKey` appear in no body, header, redirect URL, cache key, cache value, export or log |
| d | Google token-endpoint error text                                                        | Classified to a `BffErrorCode`; the original string is discarded (`classify.ts` discipline)                                                              |
| e | Cross-account cache read                                                                | Identical args under two `accountKey`s never share a cache entry                                                                                         |
| f | Cross-account token cache                                                               | Two credential sets never share a cached access token                                                                                                    |
| g | `x-seo-active-site` header spoofing                                                      | Requires `MCP_AUTH_TOKEN`, which already authorizes every site-scoped tool ⇒ no capability gain. Asserted: absent header ⇒ global tier, never a random site |
| h | `SameSite=Lax` downgrade                                                                 | Assert the exact `Set-Cookie` attribute string, and that every state-changing route remains POST or `confirm`-gated                                      |
| i | Unhealthy / not-connected site is selectable                                             | Selector disables it; the Ads/GSC route returns `site_credential_unhealthy`, never an empty result                                                       |
| j | `deleteSite` orphaning credentials                                                       | Both child rows are gone after delete, asserted directly rather than trusting a FK PRAGMA                                                                |
| k | KV absent or throwing                                                                    | Serves a live result with an `unavailable` quota estimate; the `state` nonce store failing means the callback rejects (fails **closed**, unlike the ledger) |

## Migration / Rollout

**Phase 0 is blocking and non-negotiable.** `seo-dashboard-bff` has never been deployed (`wrangler secret list` → "Worker not found"), and `bff/wrangler.jsonc:18` still carries a placeholder KV id. Google requires a registered, stable, publicly reachable `redirect_uri`, so **no** OAuth work can be exercised end-to-end until that Worker has a real origin. Ordered prerequisites: create the KV namespace and replace the placeholder id → deploy `seo-dashboard-bff` → register `https://{origin}/auth/google/callback` on the existing OAuth client → `wrangler secret put DOMAIN_CREDENTIAL_ENCRYPTION_KEY` and `GOOGLE_OAUTH_STATE_KEY` → apply migration `0004`.

**Local dev never exercises the callback for real** — there is no public HTTPS origin, so `.dev.vars`' global tier serves every site through the fallback, and the connect flow is asserted only structurally against a mocked Google token endpoint. This is a permanent property of the design, not a temporary gap.

Revertable slices, each inside the 400-line review budget: (1) migration + crypto + store, no reader; (2) `resolveSiteCredentials` + keyed token cache + the three call-site signature changes — behavior-identical while no row exists, and this slice alone closes the cross-account token leak; (3) health probes + state machine + `list_sites` status; (4) BFF OAuth routes + `state` + `gate.ts` `Lax`; (5) credential-scoped cache key + per-account ledger; (6) UI.

**Rollback**: per the proposal — `wrangler rollback` each Worker; **never drop `site_credentials`** (it holds refresh tokens unrecoverable without re-consent); and slices 2 and 5 are never rolled back while any credential row exists, because reverting either reintroduces a cross-account leak. Revoking a leaked credential happens at Google, not by rollback.

## Open Questions

- [ ] **`sites.url` must be the exact Search Console property string** (`https://example.com/` or `sc-domain:example.com`) for `sites.get` to succeed. The design deliberately does **not** fuzzy-match; a mismatch surfaces as `unhealthy(property_not_accessible)`. Whether Manage Domains should additionally offer a "pick from your accessible properties" step (a `sites.list` call at connect time) is a real UX decision left open — it is additive and does not block tasks.
- [ ] **Ads customer-ID ambiguity has no resolution path.** More than one accessible customer ⇒ `unhealthy(ads_customer_ambiguous)` and Ads stays unusable for that site. An operator picker is out of scope; confirm that is acceptable for the first release.
- [ ] `CREDENTIAL_HEALTH_TTL_SECONDS` (proposed 21600) and `MAX_CACHED_TOKENS` (proposed 8) are config constants; concrete values deferred to apply time.
- [ ] Whether `accountKey` provenance should eventually be **echoed by the tools themselves** rather than resolved BFF-side (`basis: "bff-resolved"`) — recommended follow-up, same trajectory `dashboard-insights` recorded for server-side error codes.
- [ ] `AGENTS-seo.md` is still untracked. This change supersedes its manual Playground procedure; bring it under version control and update it, or delete it deliberately.
