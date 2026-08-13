# Link Check Bounds Specification

## Purpose

Defines the provable subrequest bound that `check_links` MUST enforce so it stays under the Cloudflare
Workers Free-plan external-subrequest ceiling per invocation, and the degradation behavior required when
the bound is reached. This is a new capability — no prior spec exists for `openspec/specs/`.

## ADDED Requirements

### Requirement: Guaranteed-attempt bound stays within the link-check budget

The guaranteed-attempt subrequest count for one `check_links` invocation MUST NOT exceed the configured
link-check subrequest budget. Guaranteed attempt is defined as one page fetch (which MAY consume up to
`maxRedirects + 1` subrequests before the first link probe starts) plus one subrequest per configured
maximum link check, i.e.:

```
(maxRedirects + 1) + maxLinkChecks ≤ linkCheckSubrequestBudget
```

This MUST hold as an arithmetic relation over the live values of `maxRedirects`, `maxLinkChecks`, and
`linkCheckSubrequestBudget` in `src/config.ts`, not as a fixed pair of numbers restated in this
requirement. Any future retuning of those constants that keeps the relation true satisfies this
requirement without a spec change.

#### Scenario: Every configured link is attempted even with a redirecting page fetch

- GIVEN a page whose fetch redirects the maximum configured number of times (`maxRedirects`)
- AND the page exposes at least `maxLinkChecks` distinct links
- WHEN `check_links` runs
- THEN the subrequest budget is not exhausted before every one of the `maxLinkChecks` links has been
  attempted at least once

#### Scenario: Constants remain internally consistent

- GIVEN the current values of `maxRedirects`, `maxLinkChecks`, and `linkCheckSubrequestBudget`
- WHEN the arithmetic relation `(maxRedirects + 1) + maxLinkChecks ≤ linkCheckSubrequestBudget` is evaluated
- THEN the relation holds

### Requirement: Link-check budget stays strictly below the Free-plan ceiling

`linkCheckSubrequestBudget` MUST stay strictly below `FREE_PLAN_SUBREQUEST_CEILING`, leaving margin rather
than sitting exactly at the ceiling:

```
linkCheckSubrequestBudget < FREE_PLAN_SUBREQUEST_CEILING
```

#### Scenario: Budget has margin under the ceiling

- GIVEN the configured `linkCheckSubrequestBudget` and `FREE_PLAN_SUBREQUEST_CEILING`
- WHEN the relation `linkCheckSubrequestBudget < FREE_PLAN_SUBREQUEST_CEILING` is evaluated
- THEN it holds, so the enforced budget never equals or exceeds the platform ceiling

### Requirement: Named Free-plan ceiling constant

The Cloudflare Workers Free-plan external-subrequest ceiling MUST exist as a single named constant that
both the arithmetic invariants and any documentation referencing the ceiling derive from. The ceiling MUST
NOT be repeated as an implicit, unnamed number in requirement text, call sites, or documentation.

#### Scenario: Ceiling has one source of truth

- GIVEN the codebase defines the Free-plan external-subrequest ceiling
- WHEN any code or documentation states that ceiling
- THEN it references the single named constant rather than a restated literal value

### Requirement: Automated regression guard on the subrequest invariants

An automated test MUST assert both invariants above (guaranteed-attempt bound, and budget-under-ceiling)
against the live configured constants, so that changing `maxRedirects`, `maxLinkChecks`,
`linkCheckSubrequestBudget`, or `FREE_PLAN_SUBREQUEST_CEILING` in `src/config.ts` in a way that breaches
either invariant causes that test to fail. This requirement constrains the required test outcome; it does
not prescribe the test's internal implementation.

#### Scenario: Test fails when a constant is edited to breach the invariant

- GIVEN the regression test asserting the subrequest invariants
- WHEN any of `maxRedirects`, `maxLinkChecks`, or `linkCheckSubrequestBudget` is edited so that
  `(maxRedirects + 1) + maxLinkChecks > linkCheckSubrequestBudget`, or `linkCheckSubrequestBudget` is
  edited so it no longer stays strictly below `FREE_PLAN_SUBREQUEST_CEILING`
- THEN the regression test fails

#### Scenario: Test passes against the currently configured constants

- GIVEN the regression test asserting the subrequest invariants
- WHEN the test runs against the unmodified `src/config.ts` values
- THEN the test passes

### Requirement: The tool's own budget stops work before a platform invocation failure

When a `check_links` invocation reaches its configured subrequest budget, the tool's own budget enforcement
MUST be what halts further subrequests, not a Cloudflare Workers platform-level subrequest failure. Each
link probe that cannot complete because the budget is exhausted MUST be reported to the caller as a
structured probe entry with `state: "error"`, and the invocation MUST still return its structured
`LinkCheckResult` to the caller rather than throwing an unhandled invocation error, given that the
guaranteed-attempt bound (above) held so budget exhaustion can only occur among probes beyond the first
attempt per link.

#### Scenario: Budget exhaustion degrades to per-probe error entries

- GIVEN a `check_links` invocation whose worst-case subrequest demand (page fetch redirects plus per-probe
  redirect chains) exceeds `linkCheckSubrequestBudget`
- WHEN the configured budget is exhausted partway through probing links
- THEN the invocation completes and returns a `LinkCheckResult`
- AND every link probe that could not be attempted because the budget was exhausted appears in `results`
  with `state: "error"`
- AND the invocation does NOT fail as an unhandled platform subrequest error

#### Scenario: Under-budget invocation reports normally

- GIVEN a `check_links` invocation whose actual subrequest usage stays within `linkCheckSubrequestBudget`
- WHEN the invocation completes
- THEN every probed link is reported with `state: "ok"`, `"broken"`, or `"error"` as determined by its own
  fetch outcome, with no probe reporting `state: "error"` solely due to budget exhaustion

### Requirement: Documentation matches the enforced budgets and tool set

`README.md` MUST list `check_links` among the documented MCP tools. `README.md` MUST state the actual
configured subrequest budgets for both `crawl_site` and `check_links` in a way that is consistent with
`src/config.ts` at all times. `README.md` MUST NOT state that the MVP excludes a broken-link checker.

#### Scenario: Tool table includes check_links

- GIVEN a reader of `README.md`
- WHEN they read the tools documentation
- THEN `check_links` is listed as one of the documented tools

#### Scenario: Budget claims match configured constants

- GIVEN `README.md`'s statement of subrequest budgets
- WHEN compared against `LIMITS.linkCheckSubrequestBudget` and the `crawl_site` budget in `src/config.ts`
- THEN the stated numbers match the configured constants for both tools

#### Scenario: No stale scope-exclusion claim

- GIVEN `README.md`'s Scope section
- WHEN a reader looks for a statement about broken-link checking
- THEN no sentence claims the MVP excludes a broken-link checker
