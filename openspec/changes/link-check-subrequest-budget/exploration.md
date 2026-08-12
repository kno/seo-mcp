# Exploration — link-check-subrequest-budget

Investigation of a defect found while specifying `dashboard-bff-foundations`: the `check_links` tool's
subrequest budget is configured above the Cloudflare Free-plan ceiling it is supposed to stay under.

## The defect

`src/config.ts` sets `linkCheckSubrequestBudget: 60`. `README.md:109` states that the `crawl_site` budget of
48 exists to keep "explicit request/connection bounds below the Free-plan ceilings", and the Free plan allows
50 external subrequests per invocation. A budget of 60 therefore cannot enforce the property the repository
claims for itself.

`src/crawl/site.ts:274` shows the safe pattern for comparison: `createFetchBudget(fetcher, 48)`.

## Why 60 does not protect the invocation

`checkLinks` (`src/crawl/links.ts:95-145`) spends subrequests as follows:

| Consumer                           | Count                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Initial page fetch via `crawlPage` | 1, plus up to `maxRedirects: 3` redirect hops                                                                           |
| Link probes                        | up to `maxLinkChecks: 50`                                                                                               |
| Each probe's redirect chain        | `probeLink` follows redirects manually (`src/crawl/links.ts:52-72`), so up to `maxRedirects + 1 = 4` requests per probe |

Floor case, every link resolving in one hop and no redirect on the page fetch: `1 + 50 = 51` subrequests.
**That already exceeds the 50 ceiling before any redirect is followed.** The unbounded worst case is
`4 + (50 × 4) = 204`, which the 60 budget does clamp — but it clamps to a number still above the ceiling.

So the ordering is: the platform ceiling is reached first, and the invocation dies with a platform error
instead of the tool's graceful fail-closed path.

## Consequences

- On the Free plan, `check_links` on a link-dense page fails as a platform error, not as a bounded result.
- The failure is not attributable from the tool's own output, because the tool never gets to return.
- `dashboard-bff-foundations` had to spec around this: the BFF must surface such a failure as a normalized
  upstream error and must preserve `checked`/`ok`/`broken`/`errors` so a truncated probe set is not read as a
  clean bill of health.

## Secondary gap

`check_links` is absent from `README.md`. Commit `614d21e` added the tool without documenting it, so the
operator documentation lists four tools while the server registers five (`src/server.ts` has five
`registerTool` calls).

## The real decision this needs

The numbers interact, and any fix reduces the tool's advertised reach. Lowering only the budget does not help,
because `1 + maxLinkChecks` alone breaches the ceiling. Options:

| Approach                                                                                                  | Effect                                                                | Cost                                                         |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| Lower `maxLinkChecks` and the budget together so the floor case fits under 50 (e.g. ~40 links, budget 48) | Restores the stated safety property with one coherent pair of numbers | Fewer links probed per call — a visible capability reduction |
| ~~Keep 50 links, drop per-probe redirect following (treat 3xx as its own reported state)~~                | **IMPOSSIBLE — withdrawn**                                            | See below                                                    |
| Probe with `HEAD` and fall back to `GET`                                                                  | Does not change subrequest count at all                               | No help; rejected on the evidence                            |
| Declare `check_links` a paid-plan-only tool                                                               | Keeps current numbers                                                 | Contradicts the project's Free-plan-bounded posture          |

**Correction to this exploration (found during the proposal phase).** The second option is arithmetically
impossible and contradicts the floor-case calculation above in this same document. Keeping
`maxLinkChecks: 50` breaches the ceiling on its own — `1 + 50 = 51 > 50` — before any probe redirect is
considered, and the page fetch alone can spend `maxRedirects + 1 = 4` subrequests because `fetchBounded`
loops `redirects <= LIMITS.maxRedirects` (`src/http/fetch.ts:133`), giving `4 + 50 = 54`. Dropping per-probe
redirect following removes a multiplier that was never the binding constraint. Any compliant fix MUST lower
`maxLinkChecks`, whatever it does about redirects.

That leaves exactly one credible approach, not two. The remaining product call is only _how far_ to lower the
probe count, which is what the proposal settles.

## Constraints on any fix

- The bound must be provable from the constants, not merely asserted in prose. A test should pin the
  arithmetic so a future constant change cannot silently re-breach the ceiling.
- `README.md` must end up consistent with the tool set and with whatever numbers are chosen.
- Strict TDD applies: `pnpm test`.
