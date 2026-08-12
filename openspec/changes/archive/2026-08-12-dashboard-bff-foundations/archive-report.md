# Archive Report: dashboard-bff-foundations

**Date**: 2026-08-12  
**Change Name**: dashboard-bff-foundations  
**Archive Location**: `openspec/changes/archive/2026-08-12-dashboard-bff-foundations/`  
**Status**: ARCHIVED — COMPLETE AND READY FOR DEPENDENT CHANGES

---

## Summary

The dashboard-bff-foundations change has been successfully completed and archived. This change delivered
all server-side foundations required for the SEO MCP dashboard to operate safely: MCP output schemas with
runtime validation, a BFF Worker holding the shared authentication token, a dashboard access gate, a
result cache with single-flight dedupe, and a normalized error envelope contract.

**What shipped**: 5 chained PRs implementing 5 capabilities across 22 total MCP tools (5 in this change's
scope: `health`, `crawl_page`, `crawl_site`, `check_links`, `analyze_pagespeed`).

**Delivery**: stacked-to-main chain (PR1 -> PR2 -> PR3 -> PR4 -> PR5), all 5 phases complete and verified.

---

## Capabilities Delivered

### 1. mcp-result-contract

- Output schemas on all 5 in-scope tools (Zod v4 objects)
- Runtime validation of `structuredContent` removing the unchecked cast
- Published result-types module at `src/types/index.ts` for client consumption
- **Status**: PASS

### 2. dashboard-bff

- Service-binding BFF Worker holding `MCP_AUTH_TOKEN` server-side
- One JSON route per tool (`/api/tools/{health,crawl_page,crawl_site,check_links,analyze_pagespeed}`)
- Read-only usage/headroom endpoint to report call volume as an estimate
- Explicit per-tool timeout handling (5s health, 15s crawl_page, 30s analyze_pagespeed, 55s crawl_site/check_links)
- **Status**: PASS

### 3. dashboard-access-gate

- Authentication gates every incoming request before any upstream work
- Timing-safe credential comparison mirroring `src/http/auth.ts`
- Dashboard secret held server-side only; session cookie contains no recoverable raw secret
- Independent of server OAuth (gates dashboard access, not per-user MCP credentials)
- **Status**: PASS

### 4. bff-result-cache

- KV-backed cache with per-tool configurable TTL, clamped to [60, 86400] seconds
- Best-effort single-flight dedupe within isolates (isolate-local, not global)
- Cache failure does not block requests — KV absence or transient error yields direct upstream call
- **Status**: PASS (with coverage-precision WARNING — see below)

### 5. mcp-error-contract

- Normalized error envelope: `code` (string), `message`, optional `retryAfter`
- 11 distinct codes covering gate, validation, upstream, and timeout failures
- Secret-safe message construction (no leaked tokens, headers, or auth values)
- Upstream 401/429/503 and tool `isError` all map to stable codes
- **Status**: PASS (with design-implementation gap WARNING — see below)

---

## Carried-Forward WARNINGs (Non-Blocking)

Both WARNINGs are documented as deliberate deferrals, not spec violations or logic defects:

### WARNING 1: redactSecrets() unused

**Finding**: The `redactSecrets()` function (defined in `bff/src/errors.ts`) is unit-tested but has no live
call site in production code. Current error messages are fixed per-code strings rather than forwarding and
redacting upstream error text.

**Impact**: The spec's requirement — "no raw upstream error detail leaks secrets" — is **fully satisfied**
by the fixed generic messages (stricter than the design's originally described forwarding behavior). This is
a design-vs-implementation deviation, not a spec violation.

**Recommendation**: Either wire `redactSecrets()` into a call site for upstream text forwarding, or update
`design.md` to reflect the fixed-message behavior as shipped.

### WARNING 2: KV-failure end-to-end test coverage gap

**Finding**: The "KV binding absent or throwing" scenario is proven at the isolated `cache.ts` function
level via a `throwingKv()` mock, but never end-to-end through `dispatch`/`handleRequest` with an actual
throwing `RESULT_CACHE` binding.

**Impact**: Code inspection confirms `dispatch()` treats `"unavailable"` identically to `"miss"` (same
downstream code path), so this is **very unlikely to hide a real defect**. This is a coverage gap, not a
logic defect.

**Recommendation**: Add one `handleRequest`-level test with a throwing binding before this becomes a
load-bearing assumption for future dashboard-bff changes.

---

## Verification Evidence

### Test Results (Fresh in Archive Session)

- `pnpm test` → 444/444 passed (47 test files)
- `pnpm typecheck` → clean
- `pnpm format:check` → clean

### Requirements Coverage (17 Total, All 5 Specs)

- mcp-result-contract: 3/3 ✓
- dashboard-bff: 5/5 ✓
- dashboard-access-gate: 3/3 ✓
- bff-result-cache: 3/3 ✓ (with coverage WARNING)
- mcp-error-contract: 3/3 ✓ (with design-gap WARNING)

### Completion Status

- All 38 tasks marked `[x]`
- All 5 phases verified (PR1 PASS, PR2 PASS, PR3 PASS WITH WARNINGS, PR4 PASS WITH WARNINGS, PR5 PASS WITH WARNINGS)
- No regressions in frozen files (`src/http/*`, `src/security/*`, root `wrangler.jsonc`)

---

## Merged Specs (Main Specs Authority)

The following delta specs have been merged into authoritative main specs at `openspec/specs/`:

1. **`openspec/specs/mcp-result-contract/spec.md`** — 3 requirements, 7 scenarios
2. **`openspec/specs/dashboard-bff/spec.md`** — 5 requirements, 11+ scenarios
3. **`openspec/specs/dashboard-access-gate/spec.md`** — 3 requirements, 6 scenarios
4. **`openspec/specs/bff-result-cache/spec.md`** — 3 requirements, 6 scenarios
5. **`openspec/specs/mcp-error-contract/spec.md`** — 3 requirements, 7 scenarios

All delta specs contained `## ADDED Requirements` sections only (no MODIFIED/REMOVED/RENAMED).
Main specs now reflect all requirements without the "ADDED" framing.

---

## Dependent Changes

The following changes list `dashboard-bff-foundations` in their `dependsOn` blocks and are now unblocked:

1. **`dashboard-views`** — depends on this change for published types, per-tool routes, access gate, cache metadata, error envelope
2. **`dashboard-insights`** — depends on both this change and `dashboard-views` for similar server-side foundations

Both dependent changes' `state.yaml` files have been updated to note the archived state.

---

## No Data Loss or Regression

- All artifacts preserved in archive folder (proposal.md, exploration.md, design.md, tasks.md, verify-report.md, specs/)
- All main specs created with full content from delta specs
- **Correction (orchestrator review):** the first archive pass moved `design.md` and `verify-report.md` into this folder with rewritten/summarized content instead of the original byte-accurate files — `verify-report.md` was truncated from ~38K (five full phase sections) to ~6.6K. Both were restored from the original source folder before the original folder was deleted, so no evidence was actually lost, but the archive did require a manual correction pass rather than a clean move.
- Original change folder has been deleted, superseded by this archive, after verifying its content matched.

---

## Next Steps

1. Dependent changes (`dashboard-views`, `dashboard-insights`) can now proceed without blocking
2. Lightweight follow-up recommended: wire `redactSecrets()` or add KV-failure end-to-end test (non-blocking)
3. This change is ready for reference by any future dashboard-related work

---

## Archive Metadata

| Item                     | Value                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Archive Date             | 2026-08-12                                                                                     |
| Change Name              | dashboard-bff-foundations                                                                      |
| Location                 | openspec/changes/archive/2026-08-12-dashboard-bff-foundations/                                 |
| Artifact Count           | 11 files (proposal, exploration, design, tasks, verify-report, state, archive-report, 5 specs) |
| Main Specs Created       | 5                                                                                              |
| Status                   | ARCHIVED                                                                                       |
| Final Verdict            | PASS WITH WARNINGS — READY FOR ARCHIVE                                                         |
| Blocking Issues          | None                                                                                           |
| Carried-Forward WARNINGs | 2 (both non-blocking, documented, deferred)                                                    |
