# Design: Make the `check_links` subrequest bound honest

## Technical Approach

Constants and documentation only. Re-reading the code confirms the proposal's premise: `checkLinks`
reads `LIMITS.linkCheckSubrequestBudget` (`src/crawl/links.ts:99`), `LIMITS.maxLinkChecks` (`:108`) and
`LIMITS.linkCheckConcurrency` (`:113`); `probeLink` reads `LIMITS.linkProbeTimeoutMs` (`:47`) and
`LIMITS.maxRedirects` (`:52`, `:68`). No bound is inlined, so **zero logic edits** are required. Spec
Requirement 5 (degradation) is already satisfied: `createFetchBudget` throws on exhaustion
(`src/http/fetch.ts:48`), `probeLink`'s `catch` (`:82`) converts that into `state: "error"`, and
`checkLinks` wraps each probe again (`:118`), so a `LinkCheckResult` still returns. Verified by
reading, not by new code.

Final values in `src/config.ts`: `linkCheckSubrequestBudget: 48`, `maxLinkChecks: 40`,
`maxRedirects: 3` (unchanged), plus a new top-level `export const FREE_PLAN_SUBREQUEST_CEILING = 50`.

## Architecture Decisions

### Decision: `FREE_PLAN_SUBREQUEST_CEILING` sits beside `LIMITS`, not inside it

**Choice**: a separate exported `const`, above `LIMITS`. **Rejected**: a field inside `LIMITS`.
**Rationale**: `LIMITS` is a flat record of _our tunables_; the Free-plan ceiling is an external
platform fact. Putting it inside `LIMITS` invites someone to "tune" it. Separate keeps the existing
flat `as const` shape and makes the invariant read as `ourBudget < theirCeiling`.

### Decision: the invariant is proven by a unit test, not a module-load assertion

**Choice**: a new `test/config.test.ts` recomputing the relations from the live constants.
**Rejected**: (a) `assertWithinCeiling()` at module load; (b) a derived field, e.g.
`linkCheckSubrequestBudget: maxRedirects + 1 + maxLinkChecks`; (c) a type-level `satisfies` check.
**Rationale**: (a) turns a config typo into a cold-start throw on _every_ Worker request path,
including `health`. (b) makes the relation true by construction so it can never fail — that destroys
the guard and erases the deliberate 4-subrequest margin. (c) TypeScript cannot express `a + b <= c`
over numeric literals without brittle gymnastics. A test fails loudly in `pnpm test` at zero runtime
cost.

### Decision: the guard reads constants, never literals

The test imports `LIMITS` and `FREE_PLAN_SUBREQUEST_CEILING` and asserts
`LIMITS.maxRedirects + 1 + LIMITS.maxLinkChecks <= LIMITS.linkCheckSubrequestBudget` and
`LIMITS.linkCheckSubrequestBudget < FREE_PLAN_SUBREQUEST_CEILING`. No expected number appears as a
literal on either side, so any breaching constant edit fails the test. `test/config.test.ts` mirrors
`src/config.ts` per the project's test-mirrors-module convention; `test/links.test.ts` stays
behavioral.

## Subrequest Accounting

```text
check_links(url)  budget = 48   ceiling = 50
  page fetch      1 .. maxRedirects+1        = 1 .. 4
  link probes     maxLinkChecks x 1          = 40      -> guaranteed 44 <= 48  OK
                  maxLinkChecks x (mR+1)     = 160     -> clamped by budget at 48 < 50
```

### Decision: truncation signal — `linksFound` + `truncated`, not a re-derived count

**Choice**: `checkLinks` already builds `seen` (the deduped set of every link on the page) before
slicing it down to `targets` (capped at `maxLinkChecks`) at `src/crawl/links.ts:95`. `linksFound` is
`seen.size` — a value the function already computes, never a new crawl or a second pass. `truncated`
is a derived boolean (`linksFound > checked`), not stored independently, so the two fields can never
disagree. **Rejected**: (a) a client-side "is checked === maxLinkChecks?" inference in the UI —
`checked` can also equal `maxLinkChecks` when the page has EXACTLY 40 links with zero truncation,
which is indistinguishable from a truncated 40-of-200 without this field; (b) sending back the full
untruncated URL list — defeats the point of the cap, and turns a bandwidth-bounded response into an
unbounded one on a page with thousands of links.

**Where it flows**: `src/schemas/links.ts`'s `linkCheckResultSchema` gains both fields (required, not
optional — every `checkLinks` call computes them, there is no legacy caller to stay compatible with).
The BFF's `bff/src/mcp-client.ts` re-validates `structuredContent` against this SAME schema
(`VALIDATE_UPSTREAM_RESULTS`), so it picks up the new fields automatically — no BFF code change, only
the shared schema. `openspec/specs/dashboard-bff/spec.md`'s "One JSON Route Per Tool" requirement
already says the route returns "the tool's structured content" generically, so no BFF spec edit is
needed either. `bff/ui/src/organisms/BrokenLinksPanel.tsx` renders the signal using the SAME
`Bound`/`Cardinality` pattern `describeProbeSet` (`bff/ui/src/data/bounds.ts`) already established for
`site-crawl-view`'s per-page cap — this is that same pattern's second call site, not a new one.
`openspec/specs/broken-links-view/spec.md`'s existing "Bounded Probe Set Is Named, Not Implied
Exhaustive" requirement is amended: today it infers truncation purely from `checked ===
maxLinkChecks` (`describeProbeSet`, `bff/ui/src/data/bounds.ts:58-59`), which is exactly this
decision's rejected option (a) — a real latent defect in the shipped requirement, not a hypothetical.
The amendment replaces that inference with the two new fields and adds a scenario for the previously
unhandled case: exactly `maxLinkChecks` links found, zero truncation.

## File Changes

| File                                             | Action | Description                                                                       |
| ------------------------------------------------ | ------ | --------------------------------------------------------------------------------- |
| `src/config.ts`                                  | Modify | Add `FREE_PLAN_SUBREQUEST_CEILING = 50`; `60 -> 48`, `50 -> 40`                   |
| `test/config.test.ts`                            | Create | Regression guard on both arithmetic relations, read from the live constants       |
| `src/schemas/links.ts`                           | Modify | Add `linksFound: z.number()`, `truncated: z.boolean()` to `linkCheckResultSchema` |
| `src/crawl/links.ts`                             | Modify | Compute `linksFound` from `seen.size`, `truncated` from `linksFound > checked`    |
| `test/links.test.ts`                             | Modify | Cover both fields, truncated and non-truncated cases                              |
| `bff/ui/src/organisms/BrokenLinksPanel.tsx`      | Modify | Render a bound indicator (`describeProbeSet` pattern) when `truncated`            |
| `bff/ui/src/organisms/BrokenLinksPanel.test.tsx` | Modify | Cover the truncated / non-truncated presentation                                  |
| `openspec/specs/broken-links-view/spec.md`       | Modify | Fix "Bounded Probe Set..." to use `linksFound`/`truncated`, not `checked===limit` |
| `README.md`                                      | Modify | `check_links` row; line 26 wording; line 109 budgets; line 126 stale exclusion    |

Not touched: `src/http/**`, `src/security/**`, `src/server.ts`, `wrangler.jsonc`, `bff/src/**` (the
BFF's own code — only the shared schema it imports changes).

## README Edits (concrete)

1. **Tools table** — insert after the `crawl_site` row (server registration order):
   `| \`check_links\` | Probe a page's links for broken (4xx/5xx) and unreachable targets | 40 links max; 48-subrequest budget; 6 concurrent probes |`
2. **Line 26** — replace the trailing sentence so it no longer reads as a capability gap:
   "It does not recursively crawl links; per-page link checking is the separate `check_links` tool."
3. **Line 109** — extend the existing framing rather than replace it: after the site-crawl sentence
   add "`check_links` enforces the same 48-subrequest budget across one page fetch plus up to 40 link
   probes, keeping both tools below the Cloudflare Free-plan ceiling of 50 external subrequests per
   invocation (`FREE_PLAN_SUBREQUEST_CEILING` in `src/config.ts`)."
4. **Line 126** — delete `, and a broken-link checker` from the exclusion list. Leave the rest of the
   sentence intact.

## Testing Strategy (Strict TDD)

| Step  | Action                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RED   | Add `test/config.test.ts` against the **current** `60`/`50` values with no ceiling constant. It cannot compile/pass: `FREE_PLAN_SUBREQUEST_CEILING` does not exist yet, and `4 + 50 = 54 > 48` once the budget lands. Run `pnpm test` and record the failure. |
| GREEN | Add the ceiling constant and set `48`/`40`. `pnpm test` passes with no change to the test's assertions.                                                                                                                                                       |
| PROOF | Temporarily raise `maxLinkChecks` to `45` and confirm the test fails; revert. Satisfies the spec's "test fails when a constant is edited" scenario.                                                                                                           |

No integration test is added: `test/integration/check-links.test.ts` exercises runtime behavior that
this change does not alter.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. The change is request-facing (a `check_links` bound moves), which the
project rules flag as higher risk, but it adds no attack surface and no `src/http`/`src/security` edit.

## Migration / Rollout

No migration, no binding change, no stored state; docs and config only. Deploy is a plain
`pnpm run deploy`. Rollback is a same-day redeploy: `git revert` the constants commit (the guard test
reverts with it), then `npx wrangler deployments list` and `npx wrangler rollback [<version-id>]`.
Reverting restores the Free-plan defect, so it is a stopgap, not a resting state.

## Open Questions

Both former open decisions on `maxLinkChecks` and the `src/http/fetch.ts` alias are RESOLVED — see
`proposal.md`'s "Open Decisions — RESOLVED by the user" section. `maxLinkChecks = 40`; the
`src/http/fetch.ts` default is left alone, deliberately not aliased in this change (both real call
sites — `src/crawl/links.ts:99`, `src/crawl/site.ts:274` — pass the budget explicitly, so the default
is dead for production paths).

- [ ] Spec Requirement 6 says the `crawl_site` budget lives "in `src/config.ts`". It does not: it is
      a bare literal `48` at `src/crawl/site.ts:274`. This change keeps that byte-for-byte unchanged
      per the proposal, so README's `crawl_site` number is documented against a literal, not a
      constant. Hoisting it into `LIMITS` is a follow-up.
- [ ] `src/server.ts` registers **eight** tools (`health`, `crawl_page`, `crawl_site`, `check_links`,
      `analyze_pagespeed`, `search_console_query`, `find_striking_distance_keywords`,
      `find_low_ctr_opportunities`); README documents four, and line 126 also wrongly excludes Search
      Console. This change fixes only the `check_links` and broken-link-checker claims required by the
      spec. The remaining documentation drift is a separate change.
