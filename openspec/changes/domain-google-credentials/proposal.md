# Proposal: Per-Domain Google Credentials via "Connect Google Account"

**Risk level: HIGH.** This change adds authentication routes to a request-facing Worker surface
(`bff/src/router.ts`), introduces the first credential-at-rest storage in the repo, and alters the single
choke point every Google-backed MCP tool depends on (`src/google/auth.ts`). Per `openspec/config.yaml`,
anything touching `src/http`, `src/security` or a request-facing MCP tool surface is flagged higher risk;
this change touches the BFF equivalent of all three.

## Intent

Today the deployment holds exactly one Google identity: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
`GOOGLE_REFRESH_TOKEN` as Worker secrets (`src/config.ts:5-7`, `src/google/auth.ts:14-20`). Every site in
the `sites` table is therefore queried under the operator's own account. Adding a domain the operator does
not own in Search Console is impossible without minting a new refresh token by hand through the OAuth
Playground and re-running `wrangler secret put` — which also overwrites the previous domain's access.

A domain owner should be able to click **Connect Google Account** for their site, consent in Google's own
screen, and have the dashboard read *their* Search Console and Keyword Planner data — with the resulting
refresh token never visible to any browser, log line, or export.

## Scope

### In Scope

1. **`sites`-scoped credential storage.** New additive migration (`migrations/0004_site_credentials.sql`,
   `CREATE TABLE IF NOT EXISTS` per the `0003_sites.sql` convention) holding per-site `client_id`,
   encrypted `client_secret`, encrypted `refresh_token`, IVs, connected-at, and connected Google account
   label. Encryption is AES-GCM via Web Crypto with a random IV per write, keyed from a new Cloudflare
   secret (`DOMAIN_CREDENTIAL_ENCRYPTION_KEY`), mirroring `bff/src/session.ts:19-22,52-60`'s
   `subtle.importKey` shape.
2. **OAuth connect flow in the BFF.** Two new non-tool routes: an authorize route that mints a signed,
   single-use, expiring `state` token binding the redirect round-trip to the session and the target
   `siteUrl`, and a callback route that exchanges the authorization code server-side. The raw refresh
   token is written encrypted and **never** returned in a response body, redirect fragment, or log line.
   A matching **Disconnect** action clears the row behind the existing `assertConfirmedDelete`
   confirm-gate pattern.
3. **Credential resolution + precedence** for Search Console and Google Ads (see Approach).
4. **Token-cache correctness fix** in `src/google/auth.ts` — mandatory, not deferred (see Approach).
5. **Connected/not-connected state in the UI**, surfaced in `ManageDomainsContainer` and as a distinct
   view state (never an empty result), with a boolean-only `connected` flag round-tripping to the client.

### Out of Scope

| Deferred | Rationale |
| --- | --- |
| **Google Business Profile (all six `business_*` tools)** | Keep using the global env secrets exactly as today. They key off Business *location resource names*, never a website URL, and are deliberately absent from `bff/src/authenticated/registry.ts:6-15` — unreachable through the dashboard regardless. A future change owns them. |
| **`PAGESPEED_API_KEY`** | Stays global/env-level. `analyze_pagespeed`'s existing per-call override (`src/pagespeed/client.ts:110-132`) is a separate, already-shipped mechanism and is unaffected. |
| **An explicit `siteUrl` parameter on the Ads tools** | Resolved: Ads binds implicitly to the active site (see Approach). `cluster_keywords` needs no Google credential at all and is untouched. |
| **Encryption-key rotation / re-encryption tooling** | Genuinely new surface; a rotation procedure is a follow-up once one key is proven in production. |
| **Multi-tenant dashboard auth (per-user login)** | Still one dashboard owner. This change makes *Google accounts* per-domain, not *dashboard users*. |
| **Removing the global credential tier** | Retained deliberately as a fallback (see Approach); its removal is a follow-up change. |

## Capabilities

### New Capabilities

- `site-google-credentials`: the per-site credential model — encrypted-at-rest storage, the resolution
  precedence rule, the connected/not-connected state, disconnect, and the containment invariants that no
  stored secret is ever readable through any BFF response.
- `google-account-connect-flow`: the authorize/callback round-trip — `state` CSRF binding, single-use and
  expiry semantics, `redirect_uri` registration requirement, code-exchange failure handling, and the rule
  that no credential material appears in any redirect URL, response, or log.

### Modified Capabilities

- `authenticated-source-contract`: the "no Google credential reaches the browser" requirement must extend
  from env secrets to D1-stored per-site secrets and to the OAuth `code`/`state` values; results gain a
  `credentialSource: "site" | "global"` provenance field so the reader always knows whose account answered.
- `dashboard-bff`: introduces a second route class — non-tool-proxy OAuth routes. The registry stays
  allowlist-shaped; these routes must be explicitly enumerated, never reachable by pattern match.
- `mcp-error-contract`: new distinguishable classes for "site has no connected account" and "site
  credential revoked/expired at Google", separate from the existing quota and credential-failure classes.
- `quota-visibility`: Search Console and Ads quota are now per connected Google account, not deployment-wide;
  displaying one global number would misreport headroom.

## Approach

**Credential precedence — per-site wins, global is a deprecated fallback, tiers never mix.**
For Search Console and Ads, resolution is: if the site has a connected account, use it; otherwise fall back
to the global env tier. Recommended over deleting the global tier because (a) every existing site would
instantly become "not connected", breaking shipped `dashboard-insights` views before the OAuth flow has ever
been exercised, and (b) the same three env vars are still required by the out-of-scope `business_*` tools, so
they are not dead code in any case. The fallback is **all-or-nothing per resolution** — never a per-site
`client_id` combined with the global `refresh_token` — and is always reported through `credentialSource`, so
"answered by the operator's account" is visible rather than silent. Once every site is connected, a follow-up
change deletes the tier.

**Token cache — fixed here, not grandfathered.** `src/google/auth.ts:3`'s unkeyed module-level cache would
serve one domain's access token to another domain's request within the same isolate the moment two accounts
are connected: a cross-account data-leak bug, not a performance detail. The signature widens from
`(env, ...)` to a narrow `GoogleOAuthCredentials` object (rippling to `search-console.ts:30`, `ads.ts:71`,
`business.ts:37`), and the cache becomes keyed on a `crypto.subtle.digest` of `client_id` + `refresh_token`
so raw secrets never sit in a map key, with a bounded entry count and expiry eviction to respect the Worker
memory limit.

**Local dev keeps the global tier; production uses the connect flow.** Google cannot redirect to
`localhost`-only dev without an authorized HTTPS origin, so local development continues to work through
`.dev.vars`'s global credentials via the same fallback above. Exercising the connect flow locally requires a
tunnel URL registered as an additional authorized redirect URI. No second manual-paste credential form is
built — one credential-input path only.

## Affected Areas

| Area | Impact | Description |
| --- | --- | --- |
| `bff/src/router.ts` | Modified | Authorize + callback + disconnect routes. **Higher risk: request-facing auth surface.** |
| `bff/src/crypto/` (new) | New | AES-GCM encrypt/decrypt helpers; first encryption code in the repo. |
| `src/google/auth.ts` | Modified | Narrow credential parameter; keyed, bounded token cache. **Higher risk: shared choke point.** |
| `src/google/search-console.ts`, `src/google/ads.ts`, `src/google/business.ts` | Modified | Call-site signature updates only (`business.ts` keeps global credentials). |
| `src/db/site-store.ts`, `src/schemas/sites.ts`, `migrations/0004_*.sql` (new) | New/Modified | Credential row read/write; output schema exposes `connected` boolean only, never secrets. |
| `src/config.ts` | Modified | New `DOMAIN_CREDENTIAL_ENCRYPTION_KEY` + OAuth client binding; regenerate via `wrangler types`. |
| `bff/ui/src/containers/ManageDomainsContainer.tsx`, `bff/ui/src/app/SiteContext.tsx` | Modified | Connect/Disconnect controls; active-site binding for Ads. |
| `src/http/*`, `src/security/*`, `src/pagespeed/*` | Unchanged | Drift here is a scope escalation. |

## Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Cached access token from account A served to account B | High if cache unfixed | Keyed+bounded cache is In Scope item 4, with a RED test asserting two credential sets never share a token. |
| Refresh token leaks into a response, redirect URL, log, or export | Med | Never echoed; only a `connected` boolean in any output schema; follow `bff/src/mcp-client.ts:83-96`'s log discipline (never args/bodies); tests assert absence in every body, header, cache value, export, and log line. |
| Google token-endpoint error text echoed verbatim, revealing partial credential state | Med | Classify to a `BffErrorCode`, discard upstream text — same rule `dashboard-insights` applied to `gscError`. |
| CSRF / authorization-code injection on the callback | Med | Signed, single-use, expiring `state` bound to session + `siteUrl`; reject unbound or replayed callbacks. |
| First AES-GCM code in the repo, no precedent to copy | Med | Dedicated unit tests (round-trip, tampered ciphertext, wrong key, IV uniqueness) before any storage path is wired. |
| Encryption key lost or rotated | Low-Med | All stored credentials become undecryptable → sites read as not connected and must reconnect; documented explicitly, rotation tooling deferred. |
| Silent fallback to the operator's account misreads as "my data" | Med | `credentialSource` provenance is mandatory in every authenticated result. |
| D1 migration applied to a deployment mid-rollout | Low | Additive `CREATE TABLE IF NOT EXISTS` only; no column drop, no existing-row rewrite. |

## Rollback Plan

- **BFF slices**: `wrangler rollback` (or `wrangler versions deploy` to the prior version) on
  `seo-dashboard-bff`. The OAuth routes disappear; no site can connect, and every resolution falls back to
  the global tier — the exact behavior in production today. This is why the fallback tier is retained.
- **`seo-mcp` slice** (`src/google/auth.ts` + call sites): `wrangler rollback` on `seo-mcp` restores the
  env-only credential path. MCP hosts see no schema change.
- **D1**: leave `site_credentials` in place. It is additive and unread by rolled-back code. Do **not** drop
  it on rollback — dropping destroys refresh tokens that cannot be recovered without re-consent.
- **Never rolled back independently**: the containment rules (no secret in any response/log/export) and the
  keyed token cache. Reverting the cache fix while per-site credentials exist in D1 reintroduces the
  cross-account leak.
- **Revoking a leaked credential** is done at Google (account → third-party access), not by rollback.

## Dependencies

**Blocking prerequisite — the BFF Worker has never been deployed.** `wrangler secret list` for
`seo-dashboard-bff` returns "Worker not found"; only `seo-mcp` is deployed. Google's OAuth client requires a
registered, stable, publicly reachable `redirect_uri`, so the connect flow **cannot be exercised end-to-end
until `seo-dashboard-bff` is deployed and its origin is known.** This is a real task in this change (Phase 0),
not an assumption. Until then, work proceeds against a tunnel URL registered as an additional authorized
redirect URI, and local dev uses the global env tier.

Also required: a Google Cloud OAuth client of type "Web application" with the deployed callback URL and the
tunnel URL both registered; `DOMAIN_CREDENTIAL_ENCRYPTION_KEY` set via `wrangler secret put`; D1 binding
already present in `wrangler.jsonc`. `AGENTS-seo.md` (currently untracked) documents the manual Playground
flow this change supersedes — bring it under version control and update it, or delete it deliberately.

## Success Criteria

- [ ] A domain owner completes Connect → consent → callback and the site shows as connected, with no
      credential value present in any response body, redirect URL, header, browser storage, export, or log.
- [ ] Search Console and Ads reads for a connected site use that site's credentials; results carry
      `credentialSource: "site"`.
- [ ] A site with no connected account still resolves through the global tier and reports
      `credentialSource: "global"`; a deployment with neither renders a distinct "not connected" state,
      never an empty result.
- [ ] Two sites connected to different Google accounts never share a cached access token (asserted by test).
- [ ] `client_secret` and `refresh_token` are AES-GCM encrypted at rest with a unique IV per write; a
      tampered ciphertext fails closed rather than returning garbage.
- [ ] A replayed, expired, or session-mismatched `state` is rejected on the callback route.
- [ ] Disconnect removes the credential row behind the existing confirm-gate and returns the site to the
      not-connected state.
- [ ] `src/http/*`, `src/security/*`, and the `business_*` credential path are behaviorally unchanged.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm format:check` pass.

## Proposal question round — assumptions needing user review

Four judgment calls were made here rather than re-asked; correct any that are wrong before `sdd-spec`:

1. **Global tier retained as a per-site fallback**, not deleted, with mandatory `credentialSource`
   provenance. The alternative — no fallback, "not connected" is loud and absolute — is safer against
   cross-account confusion but breaks every currently working view on day one.
2. **Local dev uses the global env tier; the connect flow is production-only** (tunnel for local testing).
   No second manual-paste form is built.
3. **Deploying `seo-dashboard-bff` is a Phase 0 task of this change**, not a separate change.
4. **`quota-visibility` becomes per-account**, which is a visible dashboard behavior change beyond the
   credential model itself.
