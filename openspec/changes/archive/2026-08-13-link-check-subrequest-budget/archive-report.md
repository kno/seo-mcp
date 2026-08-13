# Archive Report — link-check-subrequest-budget

## Change: link-check-subrequest-budget

**Archived:** 2026-08-13
**Archive location:** `openspec/changes/archive/2026-08-13-link-check-subrequest-budget/`
**Status:** COMPLETE

## Summary

`check_links`'s guaranteed-attempt subrequest count (one page fetch, up to `maxRedirects + 1`
subrequests, plus one probe per link) could reach 54 against the real Cloudflare Free-plan ceiling of
50 external subrequests per invocation. This change makes that bound provably honest and adds a
truncation signal that fixes a related, previously-shipped defect.

## What shipped

1. **Named ceiling + regression guard**: `FREE_PLAN_SUBREQUEST_CEILING = 50` (new constant, deliberately
   separate from `LIMITS` — it's a platform fact, not a tunable). `linkCheckSubrequestBudget: 60 → 48`,
   `maxLinkChecks: 50 → 40`. `test/config.test.ts` asserts both arithmetic invariants
   (`(maxRedirects + 1) + maxLinkChecks ≤ linkCheckSubrequestBudget`, `linkCheckSubrequestBudget <
FREE_PLAN_SUBREQUEST_CEILING`) against the live constants, with no literal duplicated on either
   side — proven to be a real guard by a deliberate breach-and-revert during both apply (PROOF phase)
   and independent verification.

2. **Truncation signal (`linksFound` / `truncated`)** — a scope addition resolved in-session by explicit
   user decision (recorded in `state.yaml`'s notes) rather than deferred as the original proposal
   suggested. `LinkCheckResult` gains both fields. This fixes a real latent defect in the already-shipped
   `broken-links-view` requirement "Bounded Probe Set Is Named, Not Implied Exhaustive": the UI inferred
   truncation purely from `checked === maxLinkChecks`, which cannot distinguish a page with exactly 40
   links (zero truncation) from a truncated 40-of-200. `describeLinkCheckProbeSet` (new, in
   `bff/ui/src/data/bounds.ts`) reads the server's own `truncated`/`linksFound` fields instead.

3. **Incidental bug fix**: `checkLinks` (`src/crawl/links.ts`) built `seen` (deduped links) and `targets`
   (the capped probe list) together with an early `break`, so `seen.size` never actually reflected every
   unique link on the page — it silently equaled `targets.length` always. Fixed by building `seen` over
   ALL of `page.links` first, then slicing to `targets = [...seen].slice(0, maxLinkChecks)`. No extra
   subrequests: `page.links` was already fully parsed from the one page fetch that already happened.

4. **Documentation**: `README.md`'s tools table gains a `check_links` row; the subrequest-budget
   sentence now covers both `crawl_site` and `check_links` against the named ceiling; the stale
   "MVP excludes... a broken-link checker" clause is removed.

## Capabilities

- `link-check-bounds` (NEW): `openspec/specs/link-check-bounds/spec.md` — 6 requirements, 11 scenarios.
- `broken-links-view` (MODIFIED): "Bounded Probe Set Is Named, Not Implied Exhaustive" requirement
  amended in `openspec/specs/broken-links-view/spec.md` — this was applied directly during the apply
  phase (this project's established practice this session for amending an already-archived capability),
  verified identical to this change's own delta at `specs/broken-links-view/spec.md` before this archive
  ran.

## Verification

`sdd-verify` PASS — 0 CRITICAL, 0 WARNING, 0 SUGGESTION. Independently re-verified by the orchestrator
before commit: `pnpm test` 838/838, `pnpm typecheck` clean, `pnpm run format:check` clean. Diff scope
confirmed zero changes under `src/http/**`, `src/security/**`, `src/server.ts`, `wrangler.jsonc`,
`bff/src/**`; `src/crawl/site.ts`'s bare `48` literal at line 274 byte-for-byte unchanged. Full report:
`verify-report.md` in this folder.

## Archive integrity

The first `sdd-archive` attempt correctly detected it had no Bash/shell tool available in that
invocation and refused to fabricate the folder move rather than risk the copy-not-move /
truncated-verify-report defect seen twice earlier in this session on other changes. The orchestrator
completed the move directly: `git mv openspec/changes/link-check-subrequest-budget
openspec/changes/archive/2026-08-13-link-check-subrequest-budget` (git recorded it as a 100% rename —
byte-identical, not a copy), created `openspec/specs/link-check-bounds/spec.md` from the new-capability
delta (verified identical requirement/scenario counts: 6 requirements, 11 scenarios, 139 lines in both),
and confirmed `openspec/specs/broken-links-view/spec.md` already carried the amended requirement from
the apply phase before leaving it untouched.

## Commits

- `a67040c` — dashboard styling + login screen (prior, unrelated change on this branch)
- `a1a8a49` — feat: bound check_links under the Free-plan subrequest ceiling (this change's implementation)
