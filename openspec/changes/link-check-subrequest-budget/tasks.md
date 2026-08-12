# Tasks: Make the `check_links` subrequest bound honest

## Review Workload Forecast

| Field                   | Value                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Estimated changed lines | ~60-90 (config.ts +8/-2, new test/config.test.ts ~25 lines, README.md ~4 edited lines) |
| 400-line budget risk    | Low                                                                                    |
| Chained PRs recommended | No                                                                                     |
| Suggested split         | Single PR                                                                              |
| Delivery strategy       | ask-on-risk                                                                            |
| Chain strategy          | stacked-to-main (not needed — single PR suffices)                                      |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal                                           | Likely PR | Focused test command               | Runtime harness                                                          | Rollback boundary                                                           |
| ---- | ---------------------------------------------- | --------- | ---------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1    | Constants + regression guard + docs, in one PR | PR 1      | `pnpm test -- test/config.test.ts` | N/A — constants/docs only, no runtime scenario needed beyond `pnpm test` | `git revert` the single commit; `src/config.ts` is the only behavioral file |

## Phase 1: RED — Regression guard test (fails against old values)

- [ ] 1.1 Create `test/config.test.ts` importing `LIMITS` and `FREE_PLAN_SUBREQUEST_CEILING` from `src/config.ts`.
- [ ] 1.2 Assert `(LIMITS.maxRedirects + 1) + LIMITS.maxLinkChecks <= LIMITS.linkCheckSubrequestBudget` (Spec Req 1).
- [ ] 1.3 Assert `LIMITS.linkCheckSubrequestBudget < FREE_PLAN_SUBREQUEST_CEILING` (Spec Req 2).
- [ ] 1.4 Run `pnpm test -- test/config.test.ts` and confirm RED: fails to compile (`FREE_PLAN_SUBREQUEST_CEILING` does not exist) and/or fails arithmetically against current `60`/`50` values.

## Phase 2: GREEN — Constants change

- [ ] 2.1 In `src/config.ts`, add `export const FREE_PLAN_SUBREQUEST_CEILING = 50;` outside/above `LIMITS` (Spec Req 3).
- [ ] 2.2 In `src/config.ts`, change `LIMITS.linkCheckSubrequestBudget` from `60` to `48`.
- [ ] 2.3 In `src/config.ts`, change `LIMITS.maxLinkChecks` from `50` to `40`.
- [ ] 2.4 Run `pnpm test -- test/config.test.ts` and confirm GREEN with no assertion changes.

## Phase 3: PROOF — Confirm guard is a real regression guard

- [ ] 3.1 Temporarily raise `LIMITS.maxLinkChecks` to `45`, run `pnpm test -- test/config.test.ts`, confirm it fails, then revert (Spec Req 4, scenario "Test fails when a constant is edited").

## Phase 4: Documentation

Line numbers below are current as of this writing but this file is edited by other concurrent work —
locate each edit by its quoted anchor text, not by number, and re-check the number before editing.

- [ ] 4.1 In `README.md`'s Tools table (currently a 4-row table ending at `analyze_pagespeed`, lines 21-24),
      add a `check_links` row immediately after the `crawl_site` row: purpose "Probe a page's links for
      broken (4xx/5xx) and unreachable targets"; defaults "40 links max; 48-subrequest budget; 6 concurrent
      probes" (Spec Req 6). Note: the table is also missing `search_console_query`,
      `find_striking_distance_keywords`, and `find_low_ctr_opportunities` — those three rows are OUT OF
      SCOPE for this change (they belong to `dashboard-insights` or a dedicated README-hygiene change); do
      not add them here.
- [ ] 4.2 In `README.md` (currently line 110, immediately after the rate-limiter sentence), extend "A site
      crawl shares a 48-subrequest budget..." to also state `check_links`'s own 48-subrequest budget across
      one page fetch plus up to 40 link probes, referencing the new `FREE_PLAN_SUBREQUEST_CEILING` constant,
      while leaving the existing `crawl_site` sentence unchanged (Spec Req 6).
- [ ] 4.3 In `README.md`'s `## Scope` section (currently line 126), delete `, and a broken-link checker` from
      the MVP-exclusion list; leave the rest of the sentence intact (Spec Req 6). This sentence is also
      already false about Search Console (`search_console_query` shipped) — that correction is OUT OF SCOPE
      for this change; touch only the broken-link-checker clause.

## Phase 5: Verification

- [ ] 5.1 Run `pnpm test`, `pnpm typecheck`, `pnpm run format:check` and confirm all pass.
- [ ] 5.2 Confirm no file under `src/http/` or `src/security/` was modified (diff review).
- [ ] 5.3 Confirm `src/crawl/links.ts` has zero edits — every bound still reads from `LIMITS` (diff review).
- [ ] 5.4 Confirm `crawl_site`'s bare `48` literal at `src/crawl/site.ts:274` is byte-for-byte unchanged (diff review).

## Deferred (not tasked — future change)

- `crawl_site`'s subrequest budget is a bare literal `48` at `src/crawl/site.ts:274`, unprotected by any regression guard. Explicitly out of scope per proposal; a future change should hoist it into `LIMITS` and extend the guard test.
