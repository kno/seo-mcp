# Archive Report — dashboard-views

## Change: dashboard-views

**Archived:** 2026-08-13  
**Archive location:** `openspec/changes/archive/2026-08-13-dashboard-views/`  
**Status:** COMPLETE — Ready for next change

## Summary

The `dashboard-views` SDD change is now archived. All 20 tasks across 7 phases are complete. All 38 requirements across 7 new capability specs are satisfied with passing runtime evidence. Zero CRITICAL issues. Ready for production deployment.

## What Shipped

### Implementation Phases (7 chained PRs)

1. **PR1 (Build Wiring)**: SPA build wiring, assets binding with `run_worker_first: true`, gate-before-assets ordering test
2. **PR2 (Shell)**: Dashboard navigation, design-system baseline (atomic design), shared error/loading/empty/bound state contract
3. **PR3 (Page Report)**: `crawl_page` view rendering on-page metadata, headings, link counts, Open Graph, JSON-LD, issues
4. **PR4 (Broken Links)**: `check_links` panel with user-triggered-only access, all 4 counts visible, broken-vs-error distinction
5. **PR5 (Site Crawl)**: `crawl_site` view with bounded controls (defaults 5/2, max 20/4), domain summary, crawl policy, link graph, per-page table
6. **PR6 (PageSpeed)**: `analyze_pagespeed` view with scores, lab metrics, opportunities; security fix for apiKey transport (GET→POST)
7. **PR7 (Export & Quota)**: JSON/CSV export with provenance, quota/freshness visibility via HeadroomIndicator and FreshnessBadge

### New Capabilities (7 specs, 38 requirements)

- `dashboard-shell` (6 requirements): error mapping, rate-limit handling, state distinction, no-polling, keyboard access, responsive layout
- `page-report-view` (6 requirements): on-page card, headings, link counts, Open Graph, JSON-LD, issues list
- `broken-links-view` (5 requirements): on-demand checking, all 4 counts visible, broken-vs-error distinction, probe cap, error handling
- `site-crawl-view` (7 requirements): bounded controls, domain summary, crawl policy, link graph, per-page drill-down, bound distinction, progress
- `pagespeed-view` (6 requirements): URL/strategy input, score presentation, lab metrics, field data, opportunities, key security
- `result-export` (5 requirements): JSON fidelity, CSV stability, truncation provenance, no secrets, never blocked
- `quota-visibility` (3 requirements): headroom estimate, result age, retryAfter handling

### Modified Capability

- `dashboard-bff`: Added requirement "A Secret-Bearing Input Never Travels as a Query-String Parameter" (apiKey POST-only fix)

## Implementation Stats

| Metric                   | Value                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Total tasks              | 20                                                                                               |
| Completed tasks          | 20 (100%)                                                                                        |
| Total test files         | 94                                                                                               |
| Total tests passed       | 817                                                                                              |
| Phases shipped           | 7 chained PRs                                                                                    |
| Commits in main sequence | 7 (f752133, da55a7d, af5952a, 62ce3e6, a767464, ef7ac10, cb33252)                                |
| Files created in bff/ui/ | ~50 (components, containers, data, export, charts)                                               |
| New devDependencies      | vite, @vitejs/plugin-react, jsdom, @testing-library/react, @testing-library/user-event, axe-core |

## Verification Outcomes

### All 7 specs verified PASS across all 38 requirements

- dashboard-shell (6/6): Error mapping, rate-limit, state distinction, no-polling (verified with structural test), keyboard, responsive
- page-report-view (6/6): On-page card, headings, link counts, OG, JSON-LD, issues (all 13 codes + unknown)
- broken-links-view (5/5): On-demand, all counts visible, broken-vs-error, probe bound, error handling
- site-crawl-view (7/7): Bounded controls, domain summary, crawl policy, link graph, drill-down, bound distinction, progress
- pagespeed-view (6/6): URL/strategy, scores, metrics, field data, opportunities, key security (POST-only verified)
- result-export (5/5): JSON fidelity, CSV stability, provenance, no secrets, never blocked
- quota-visibility (3/3): Headroom estimate, result age, retryAfter

### Security-sensitive requirements verified under maximum scrutiny

- **PageSpeed apiKey transport (Phase 6)**: GET query-string path actively rejected; POST body path only; no key in exports or storage
- **Secret exclusion (Phase 7)**: No apiKey, MCP_AUTH_TOKEN in exports; SecretCell one-shot verified; signature-level safety (no request state accepted)
- **No-polling structural test (Phase 2)**: Real filesystem scan, break-it-to-prove-it violations tested; fetchUsage exception scoped narrowly

### Carried-forward items resolved

- _*PR1 `/api/* 404 guard test_*: Now confirmed RESOLVED — guard was always covered by pre-existing test; original finding was mistaken
- **PR2 design.md staleness**: RESOLVED before this archive. `design.md`'s route-contract and secret-transport illustrations (`POST /api/tools/{tool}` generically, `stripSecrets()`) were corrected in a dedicated commit to match the real, frozen `GET`-by-default / `POST`-for-`apiKey`-only contract, before this archive phase ran. The `verify-report.md` content in this archive predates that fix and still describes it as open — read alongside this correction, not as a contradiction.

## Known Issues

None open. The one documentation-only staleness found during verification (`design.md` illustrating
`POST /api/tools/{tool}` generically instead of the real `GET`-by-default contract, and referencing a
`stripSecrets()` function that was never built) was corrected in a dedicated commit before this archive
phase ran. `design.md` as archived here already reflects the real, frozen router contract.

## Correction to This Archive Pass (orchestrator review)

The first archive attempt for this change repeated a defect already seen once in this project's history
(`dashboard-bff-foundations`'s archive): it copied the change folder instead of moving it, and did not copy
`specs/` into the archive location at all, while also writing a truncated `verify-report.md` (88.1 KB /
1192 lines in the source, only ~14.3 KB in the first archived copy). The orchestrator caught this by
diffing the archived files against the source before deleting anything, restored `verify-report.md` and
`specs/` byte-for-byte from the source folder, verified every artifact identical (`proposal.md`'s checkbox
completions are the one legitimate, intentional edit), and only then deleted the original
`openspec/changes/dashboard-views/` folder. No evidence was actually lost, but — as with the prior
archive — this required a manual correction pass rather than a clean move.

## Archive Contents

### Artifacts

- `proposal.md`: Full proposal with scope, outcomes, approach, risks, rollback
- `design.md`: Technical design (432 lines) with architecture decisions, error mapping, mechanisms, testing strategy
- `tasks.md`: 20 tasks across 7 phases, all marked `[x]`, with work unit breakdown
- `state.yaml`: Change metadata, capability list, dependency tracking
- `verify-report.md`: Full verification report (1192 lines) with all phase results, security scrutiny, compliance matrix

### Specs (7 new domains, 38 requirements total)

- `specs/dashboard-shell/spec.md`: 6 reqs, 17 scenarios — error mapping, rate-limit, state distinction, no-polling, keyboard, responsive
- `specs/page-report-view/spec.md`: 6 reqs, 16 scenarios — on-page card, headings, link counts, OG, JSON-LD, issues
- `specs/broken-links-view/spec.md`: 5 reqs, 11 scenarios — on-demand, 4 counts, broken-vs-error, probe bound, error handling
- `specs/site-crawl-view/spec.md`: 7 reqs, 19 scenarios — bounded controls, summary, policy, link graph, drill-down, bounds, progress
- `specs/pagespeed-view/spec.md`: 6 reqs, 17 scenarios — input, scores, metrics, field data, opportunities, key security
- `specs/result-export/spec.md`: 5 reqs, 11 scenarios — JSON fidelity, CSV stability, provenance, no secrets, never blocked
- `specs/quota-visibility/spec.md`: 3 reqs, 8 scenarios — headroom estimate, result age, retryAfter

### Traceability

**Engram Observation IDs** (all artifacts persisted to memory):

- Proposal: #2887
- Spec (4 domains): #2888
- Design: #2892
- Tasks: #2895
- Verify-report: #2907

**Merged into `openspec/specs/` (source of truth)**:

- `openspec/specs/dashboard-shell/spec.md` — NEW
- `openspec/specs/page-report-view/spec.md` — NEW
- `openspec/specs/broken-links-view/spec.md` — NEW
- `openspec/specs/site-crawl-view/spec.md` — NEW
- `openspec/specs/pagespeed-view/spec.md` — NEW
- `openspec/specs/result-export/spec.md` — NEW
- `openspec/specs/quota-visibility/spec.md` — NEW
- `openspec/specs/dashboard-bff/spec.md` — MODIFIED (added "A Secret-Bearing Input Never Travels as a Query-String Parameter")

## File Size Verification (orchestrator-performed, after the correction above)

Source (`openspec/changes/dashboard-views/`, before deletion):

- `design.md`: 432 lines, 38.0 KB
- `verify-report.md`: 1192 lines, 88.1 KB

Archived copy, after the correction:

- `design.md`: 432 lines, 38.0 KB — `diff` exit 0, byte-identical
- `verify-report.md`: 1192 lines, 88.1 KB — `diff` exit 0, byte-identical (restored from source after the
  first archive pass truncated it to ~14.3 KB)
- `specs/` — `diff -rq` exit 0 across all seven domain files, byte-identical (the first archive pass did
  not copy this directory into the archive location at all)

Original folder `openspec/changes/dashboard-views/` confirmed deleted only after the above diffs passed.

## Dependency Status

**Blocking dependency (RESOLVED):**

- `dashboard-bff-foundations` — archived at `openspec/changes/archive/2026-08-12-dashboard-bff-foundations/`
  - All 5 required capabilities shipped: mcp-result-contract, dashboard-bff, dashboard-access-gate, mcp-error-contract, bff-result-cache
  - types: `mcp-result-contract` spec in openspec/specs/
  - routes: `dashboard-bff` spec + POST /api/tools/{tool} + GET /api/usage both verified
  - gate: `dashboard-access-gate` spec in openspec/specs/
  - errors: `mcp-error-contract` spec in openspec/specs/
  - cache: `bff-result-cache` spec in openspec/specs/

**Sibling changes:**

- `dashboard-insights`: May consume shell/quota-visibility patterns from this change; check for dependency

## Recommendation

✅ **ARCHIVE COMPLETE** — Change is ready for production deployment.

The dashboard-views implementation is stable, fully tested, and verified against all 38 specifications. The security-sensitive features (apiKey handling, no-polling, quota visibility) were verified under maximum skepticism with real reproducers, not assumptions. The one remaining open item is a documentation-only warning about staleness in design.md illustrations, which does not affect spec compliance or deployment.

**Next Steps:**

1. PR review/merge of the 7-PR chain if not already merged
2. Deployment via `wrangler deploy -c bff/wrangler.jsonc` (with `build:ui` prerequisite)
3. Optional follow-up: small PR to correct design.md illustrations for future clarity

---

**Archived by:** SDD archive phase  
**Date:** 2026-08-13  
**Cycle time:** Proposal → Archive (7 days)
