# Verification Report: link-check-subrequest-budget

**Mode**: Full artifacts (proposal, design, specs, tasks) — Engram + OpenSpec hybrid
**Date**: 2026-08-13
**Verdict**: PASS

## Task Completeness

23/23 tasks in `tasks.md` marked `[x]` (Phases 1-6). No unchecked tasks. Confirmed by direct grep
(`0` unchecked, `23` checked).

## Runtime Evidence (executed directly, not taken on report)

| Command | Result |
| --- | --- |
| `pnpm test` | 838/838 passed, 96/96 test files, run twice for confirmation |
| `pnpm typecheck` | clean (`tsc --noEmit` root + `bff/ui`) |
| `pnpm run format:check` | clean (Prettier, all files) |
| Deliberate regression check: edited `LIMITS.maxLinkChecks` 40→45 in `src/config.ts`, ran `pnpm test` | `test/config.test.ts` failed as expected (2 failed test files: the invariant test itself, plus `bounds.test.ts`'s `collectBounds` check_links fixture, an expected collateral effect of a shared constant). Reverted; `git diff -- src/config.ts` shows only the intended `+4/-2` change afterward. |

## Spec Compliance Matrix — `link-check-bounds/spec.md` (new capability)

| Requirement | Scenario | Evidence | Status |
| --- | --- | --- | --- |
| Guaranteed-attempt bound stays within budget | Every configured link attempted despite redirecting fetch | `test/config.test.ts`: `LIMITS.maxRedirects + 1 + LIMITS.maxLinkChecks <= LIMITS.linkCheckSubrequestBudget` (4+40=44≤48) — asserted against live `LIMITS`, not literals | PASS |
| | Constants remain internally consistent | same test | PASS |
| Budget stays strictly below Free-plan ceiling | Budget has margin under ceiling | `test/config.test.ts`: `LIMITS.linkCheckSubrequestBudget < FREE_PLAN_SUBREQUEST_CEILING` (48<50) | PASS |
| Named Free-plan ceiling constant | Ceiling has one source of truth | `FREE_PLAN_SUBREQUEST_CEILING = 50` defined once in `src/config.ts`; `README.md:110` references the constant by name, no restated literal ceiling found elsewhere | PASS |
| Automated regression guard | Test fails when a constant breaches the invariant | Verified live: raising `maxLinkChecks` to 45 failed `test/config.test.ts` | PASS |
| | Test passes against current constants | `pnpm test` green | PASS |
| Tool's own budget stops work before platform failure | Budget exhaustion degrades to per-probe error entries / under-budget reports normally | Behavior unchanged from pre-existing `checkLinks`/`probeLink` (out of scope for this change per proposal — constants-only); existing `test/links.test.ts` (9 tests, unchanged pass) and `test/integration/check-links.test.ts` (new/extended, passing) cover probe error-state degradation | PASS (pre-existing coverage, no regression) |
| Documentation matches enforced budgets and tool set | Tool table includes check_links | `README.md:24` — `check_links` row present with "40 links max; 48-subrequest budget; 6 concurrent probes" | PASS |
| | Budget claims match configured constants | `README.md:110` states `check_links` 48-subrequest budget / 40 probes, `crawl_site` 48-subrequest budget — matches `LIMITS` in `src/config.ts` exactly | PASS |
| | No stale scope-exclusion claim | `README.md:127` (Scope section) — grep for "broken-link checker" returns zero matches | PASS |

## Spec Compliance Matrix — `broken-links-view/spec.md` delta (amended requirement)

Requirement: "Bounded Probe Set Is Named, Not Implied Exhaustive"

| Scenario | Covering test | Status |
| --- | --- | --- |
| Truncated result shows a bound indicator naming both figures (`truncated:true, checked:40, linksFound:127`) | `BrokenLinksPanel.test.tsx` "shows a bound indicator naming both figures when truncated is true"; `BrokenLinksContainer.test.tsx` "shows a bound indicator when the result is truncated" | PASS |
| Untruncated result **at the exact limit** shows no bound indicator (`truncated:false, checked:40, linksFound:40`) — the bug this change fixes | `BrokenLinksPanel.test.tsx` "shows no bound indicator when truncated is false, even at the exact limit"; `BrokenLinksContainer.test.tsx` "shows no bound indicator when checked hits the limit but truncated is false" | PASS |
| Untruncated result below the limit shows no bound indicator | `BrokenLinksContainer.test.tsx` "shows no bound indicator when checked is below the server's limit" (`checked:4` result, no bound indicator) | PASS |

All three scenarios have a real, runtime-passing covering test. The previously-latent bug (`describeProbeSet`'s
`checked === limit` inference, which could not distinguish "40 of 40, done" from "40 of 200, truncated") is fixed
by the new `describeLinkCheckProbeSet` (reads `truncated`/`linksFound` directly) and is exercised at both the
pure-presentational (`BrokenLinksPanel`) and container/integration (`BrokenLinksContainer`) layers.

Other (unmodified) requirements in this spec — trigger gating, four-counts-always-visible, broken/error
distinction, upstream-failure-as-error — remain covered by their pre-existing passing tests, unaffected by this
change's diff.

## Diff-Scope Verification (task 6.2-6.5)

Ran `git diff HEAD --stat` / targeted `git diff HEAD --` directly (not taken from the apply report):

| Claim | Verified |
| --- | --- |
| Zero edits under `src/http/**` and `src/security/**` | Confirmed — absent from `git diff HEAD --stat` entirely |
| `src/server.ts`, `wrangler.jsonc` unchanged | Confirmed — absent from diff |
| `bff/src/**` zero edits (only `bff/test/**` and `bff/ui/**` touched) | Confirmed — `bff/src` absent from diff; touched BFF files are `bff/test/integration/stub-mcp-worker.js`, `bff/test/mcp-client.test.ts`, `bff/test/router.test.ts` (fixtures/tests only) plus `bff/ui/**` |
| `src/crawl/links.ts`'s only edit is the `linksFound`/`truncated` computation | Confirmed via direct diff read: removed early-break `seen`/`targets` co-construction bug, rebuilt `seen` over all links then sliced `targets`, added `linksFound: seen.size` and `truncated: seen.size > results.length`. No probe/redirect logic touched. |
| `crawl_site`'s bare `48` literal at `src/crawl/site.ts:274` byte-for-byte unchanged | Confirmed — `git diff HEAD -- src/crawl/site.ts` is empty |

Full changed-file list (`git diff HEAD --stat`, 22 files): `README.md`, `bff/test/integration/stub-mcp-worker.js`,
`bff/test/mcp-client.test.ts`, `bff/test/router.test.ts`, `bff/ui/src/containers/BrokenLinksContainer.{tsx,test.tsx}`,
`bff/ui/src/data/bounds.{ts,test.ts}`, `bff/ui/src/export/csv.{ts,test.ts}`,
`bff/ui/src/organisms/BrokenLinksPanel.{tsx,test.tsx}`, 4 openspec change-folder docs, `openspec/specs/broken-links-view/spec.md`,
`src/config.ts`, `src/crawl/links.ts`, `src/schemas/links.ts`, `test/integration/check-links.test.ts`,
`test/schemas/links.test.ts`, plus new untracked `test/config.test.ts` and the delta spec file.

## Design Coherence

`design.md`'s "truncation signal" section (the resolved scope addition) is implemented exactly as specified:
`linkCheckResultSchema` gains `linksFound`/`truncated`; `checkLinks` computes them; BFF re-validation needs no
edit (same schema import, confirmed — `bff/src/**` diff is zero); `BrokenLinksPanel`/`BrokenLinksContainer` wired
via the new `describeLinkCheckProbeSet` following the existing `Cardinality`/`isBounded` pattern
`SiteCrawlContainer` already established. CSV export (`bff/ui/src/export/csv.ts`) also picked up the two new
fields, keeping the export/panel provenance in sync per `design.md`'s "one Bound[] per tool result" principle —
not explicitly tasked but a correct, low-risk consistency fix.

## Issues

None CRITICAL. None WARNING. None SUGGESTION.

One minor observation (informational, not a defect): `state.yaml`'s `phases.apply`/`verify`/`archive` still read
`pending` at verification time — expected, since this report is what will flip `verify` to `done`; not a defect
in the applied change itself.

## Final Verdict: PASS

All 23 tasks complete and code-consistent. All spec requirements/scenarios in both `link-check-bounds/spec.md`
and the `broken-links-view/spec.md` delta have a runtime-passing covering test, verified directly by re-running
the suite (838/838), typecheck, format:check, and a live deliberate-breach regression check. Diff scope matches
every claim in tasks.md Phase 6 and the proposal's `Out of Scope`/`Success Criteria` sections, verified by direct
`git diff` inspection rather than trusting the apply report. Ready for `sdd-archive`.
