# Proposal: Make the `check_links` subrequest bound honest

## Intent

`check_links` claims a bounded subrequest budget it cannot enforce. `LIMITS.linkCheckSubrequestBudget: 60`
sits above the Cloudflare Free-plan ceiling of 50 external subrequests per invocation, and the floor case
`1 page fetch + maxLinkChecks: 50 probes = 51` breaches that ceiling before any redirect is followed. On the
Free plan a link-dense page therefore dies as a platform error instead of the tool's graceful fail-closed
path, so the failure is not attributable from the tool's own output. `README.md:109` asserts the opposite
property. This change makes the numbers true.

## Correction to the exploration

Exploration option (b) — "keep 50 links, drop per-probe redirect following" — **does not fit**. Even at one
subrequest per probe, the page fetch can consume up to `maxRedirects + 1 = 4`, so `4 + 50 = 54 > 50`, and the
floor `1 + 50 = 51 > 50`. Any compliant fix must lower `maxLinkChecks` below 46 regardless. Option (b)'s only
selling point (preserved reach) is unavailable, so a hybrid is not a compromise — it is the sole option that
holds.

## Chosen numbers

| Constant                       | From           | To                        | Reason                                                                      |
| ------------------------------ | -------------- | ------------------------- | --------------------------------------------------------------------------- |
| `FREE_PLAN_SUBREQUEST_CEILING` | implicit prose | `50` (new named constant) | Stop spreading the platform ceiling across prose and two call sites         |
| `linkCheckSubrequestBudget`    | `60`           | `48`                      | Matches `crawl_site`; 2 subrequests of margin under the ceiling             |
| `maxLinkChecks`                | `50`           | `40`                      | Makes the no-probe-redirect case fit with redirect headroom                 |
| per-probe redirect following   | on             | **unchanged**             | Preserves reported semantics: a 3xx link still resolves to its final status |

Proof of bound (all values from `src/config.ts`):

- Guaranteed attempt: `(maxRedirects + 1) + maxLinkChecks = 4 + 40 = 44 ≤ 48` — every one of the 40 links is
  probed even if the page fetch redirects three times.
- Enforcement: the budget clamps the unbounded worst case `4 + (40 × 4) = 164` to `48 < 50`, so the tool's own
  error fires first and probes degrade to reported `state: "error"`, never a platform crash.
- Ceiling: `linkCheckSubrequestBudget (48) ≤ FREE_PLAN_SUBREQUEST_CEILING (50) − 2`.

Tradeoff accepted: **advertised reach drops from 50 links to 40 per call (−20%)**. In practice reach rises,
because the previous 50 was unreachable on the Free plan — the invocation failed instead.

## Scope

### In Scope

- `src/config.ts`: add `FREE_PLAN_SUBREQUEST_CEILING: 50`; set `linkCheckSubrequestBudget: 48`,
  `maxLinkChecks: 40`.
- A test that pins the arithmetic to the named ceiling so a future constant edit cannot silently re-breach it.
- `README.md`: add `check_links` to the Tools table with its real defaults; rewrite line 109 to state both
  budgets (`crawl_site` 48, `check_links` 48 with 40 probes) against the named ceiling; fix line 126, which
  still says the MVP excludes a broken-link checker.

### Out of Scope

- The dashboard/BFF work (`dashboard-bff-foundations`); this change fixes only the server-side bound.
- The other actor's in-flight per-page-timing feature.
- `crawl_site`'s 48 budget, which is already correct.
- Broadening `check_links` capability, including any new result field such as `linksFound` or `truncated` —
  that would change the result shape `dashboard-bff-foundations` is specifying an output schema for.

## Capabilities

### New Capabilities

- `link-check-bounds`: the subrequest bound `check_links` enforces, its provable relation to the Cloudflare
  Free-plan ceiling, and the degradation behaviour when the budget is exhausted.

### Modified Capabilities

- None. `openspec/specs/` is currently empty, so there is no main spec to delta.

## Approach

Constants only. `src/crawl/links.ts` already reads every value from `LIMITS`, so no logic changes and no
edits to `src/http/*` or `src/security/*`. The invariants are asserted in a unit test against
`FREE_PLAN_SUBREQUEST_CEILING`, not against literals, so the test fails on any future constant drift. Strict
TDD: the failing invariant test lands before the constant change.

## Affected Areas

| Area                                        | Impact                        | Description                                 |
| ------------------------------------------- | ----------------------------- | ------------------------------------------- |
| `src/config.ts`                             | Modified                      | Two values changed, one named ceiling added |
| `test/links.test.ts` (or a new budget test) | Modified/New                  | Pins the arithmetic invariants              |
| `README.md`                                 | Modified                      | Tool table, line 109, line 126              |
| `src/http/fetch.ts:41`                      | **Not touched** (recommended) | Hardcoded `maximum = 48` default; see risks |

## Risks

| Risk                                                                                                                                     | Likelihood      | Mitigation                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Request-facing MCP surface** (project rule): `check_links` behaviour changes for every client — `checked` can no longer exceed 40      | High (intended) | No schema change, so no client breakage. Document the new bound in `README.md`; announce as a corrected bound, not a regression                                                                                                                                          |
| Editing `createFetchBudget`'s `maximum = 48` default in `src/http/fetch.ts:41` would touch a 5-caller shared path including `crawl_site` | Low if avoided  | **Higher risk per project rule — do not touch it in this change.** Pass the budget explicitly, as both call sites already do                                                                                                                                             |
| 40 links is too few for real link-dense pages                                                                                            | Medium          | Open decision 1 below; recursive/site-wide link checking is already future work in `ROADMAP.md:36`                                                                                                                                                                       |
| Contradicting `dashboard-bff-foundations`                                                                                                | Low             | Verified compatible: its `check_links` timeout of 55 s was derived as `50 × 6 s ÷ 6`; at 40 probes the bound falls to ~40 s, so the 55 s ceiling stays valid and conservative. Its design note at line 295 explicitly defers this defect to a separate change — this one |
| Budget exhaustion is reported per-probe as `state: "error"`, indistinguishable from a network error                                      | Medium          | Message text already names the budget; leave the machine-readable signal to a later change (out of scope above)                                                                                                                                                          |

## Rollback Plan

Behaviour-visible to MCP clients, so rollback must be explicit:

1. `git revert` the constants commit — `src/config.ts` is the only behavioural file, so the revert is
   self-contained and the invariant test reverts with it.
2. Redeploy the previous Worker version: `npx wrangler deployments list` then
   `npx wrangler rollback [<version-id>]`.
3. No data migration, no binding change, no `wrangler.jsonc` change, no stored state. Reverting restores the
   pre-existing Free-plan defect, so rollback is a stopgap, not a resting state.

## Dependencies

`dashboard-bff-foundations` and `dashboard-views` are both archived
(`openspec/specs/dashboard-bff/spec.md`, `openspec/specs/broken-links-view/spec.md`). Decision 3 below
(resolved: add the truncation signal now) means this change amends both: `linkCheckResultSchema` grows two
fields, so the BFF's re-validation and the UI's `BrokenLinksPanel`/`BrokenLinksContainer` both need a
matching, coordinated update in this same change — not a follow-up.

## Open Decisions — RESOLVED by the user (2026-08-13)

1. **`maxLinkChecks = 40` or `44`?** → **40.** Keeps the redirect-headroom margin; design.md already assumed
   this value.
2. **Alias the `48` default in `src/http/fetch.ts:41` to the new named constant?** → **No.** Left alone;
   `src/http` stays untouched by this change, per the original recommendation.
3. **Add a truncation signal (`linksFound` / `truncated`) now, or defer?** → **Now.** `linkCheckResultSchema`
   gains `linksFound: number` (unique links found on the page, before the `maxLinkChecks` cap) and
   `truncated: boolean` (`linksFound > checked`). This is no longer out of scope — see the new "Truncation
   signal" section in `design.md` for the full file list (schema, `checkLinks`, BFF re-validation is
   automatic since it re-validates against the same schema, `BrokenLinksPanel`, `broken-links-view` spec
   amendment).

## Success Criteria

- [ ] `pnpm test` passes, including a test asserting `1 + maxLinkChecks ≤ linkCheckSubrequestBudget`,
      `(maxRedirects + 1) + maxLinkChecks ≤ linkCheckSubrequestBudget`, and
      `linkCheckSubrequestBudget < FREE_PLAN_SUBREQUEST_CEILING`.
- [ ] That test fails if `maxLinkChecks`, `maxRedirects`, or either budget is raised — verified by a deliberate
      temporary edit during verification.
- [ ] `pnpm typecheck` and `pnpm format:check` pass.
- [ ] `README.md` lists five tools including `check_links`, and no line in `README.md` claims a budget or a
      missing capability that contradicts `src/config.ts` or `src/server.ts`.
- [ ] `crawl_site`'s budget of 48 is byte-for-byte unchanged.
- [ ] No file under `src/http/` or `src/security/` is modified.
