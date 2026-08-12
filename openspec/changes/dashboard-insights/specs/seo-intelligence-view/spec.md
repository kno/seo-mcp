# Delta for SEO Intelligence View

## Reconciliation status

All five tools this capability covers now exist and are RECONCILED against their real shape, read from
`src/seo/domain-report.ts`, `src/seo/intelligence.ts`, `src/seo/keyword-pages.ts`, and `src/server.ts`:

- `analyze_domain` — input `{ url, limit?: 1-20, concurrency?: 1-4, gscProperty?: string, startDate?, endDate?,
opportunityLimit?: 1-100 }` (`src/server.ts:767-792`). `gscProperty`/`startDate`/`endDate` are OPTIONAL — GSC
  enrichment is opt-in per call, not always-on. Result is `DomainReport` (`src/seo/domain-report.ts:13-26`):
  `{ url, crawl: { sitemapFound, crawled, failed, issueCounts, summary, crawlPolicy, linkGraph }, search?:
DomainSearch, gscError?: string }`, where `DomainSearch = { startDate, endDate, opportunities: Opportunity[] }`
  (`:7-11`). The `crawl` sub-object reuses `SiteCrawlResult`'s `summary`, `crawlPolicy`, and `linkGraph` fields
  directly — the same shapes `site-crawl-view` already renders.
- `find_seo_opportunities` — input `{ siteUrl, startDate, endDate, limit?: 1-100 }` (`src/server.ts:368-377`).
  Result: `{ siteUrl, startDate, endDate, count, opportunities: Opportunity[] }` (`src/seo/intelligence.ts:220-263`).
- `find_keyword_cannibalization` — input `{ siteUrl, startDate, endDate, minImpressions?: int>=0, limit?: 1-50 }`
  (`src/server.ts:341-351`). Result: `{ siteUrl, startDate, endDate, count, groups: CannibalGroup[] }`
  (`src/seo/intelligence.ts:173-218`).
- `map_keywords_to_pages` — input `{ siteUrl, startDate, endDate, limit?: 1-100, topQueriesPerPage?: 1-50 }`
  (`src/server.ts:394-404`). Result: `{ siteUrl, startDate, endDate, count, pages: PageKeywords[] }`
  (`src/seo/keyword-pages.ts:124-169`).
- `find_content_gaps` — input `{ siteUrl, startDate, endDate, minPosition?: 1-100, minImpressions?: int>=0,
limit?: 1-100 }` (`src/server.ts:421-432`). Result: `{ siteUrl, startDate, endDate, count, gaps: ContentGap[] }`
  (`src/seo/keyword-pages.ts:171-218`).

Shared shapes:

- `Opportunity` (`src/seo/intelligence.ts:30-40`): `{ type: OpportunityType, query, page: string | null,
impressions, currentPosition: number | null, impact: number, effort: number, priorityScore: number,
recommendation: string }`. `OpportunityType` (`:27-28`) is `"low_ctr" | "striking_distance" |
"cannibalization"`.
- `CannibalGroup` (`:19-25`): `{ query, pageCount, totalImpressions, totalClicks, pages: CannibalPage[] }`;
  `CannibalPage` (`:12-17`): `{ page, clicks, impressions, position }`.
- `PageKeywords` (`src/seo/keyword-pages.ts:15-21`): `{ page, queryCount, totalClicks, totalImpressions,
topQueries: PageQuery[] }`; `PageQuery` (`:8-13`): `{ query, clicks, impressions, position }`.
- `ContentGap` (`:23-29`): `{ query, page, impressions, clicks, position }`.

Six reconciliation findings change or add requirements below rather than merely confirming the original
provisional invariants — see the reconciled requirements:

1. **`Opportunity.type` and `Opportunity.recommendation` already are the evidence/provenance field.** `type`
   names which of the three named synthesis signals (`low_ctr`, `striking_distance`, `cannibalization`)
   produced the opportunity, and `recommendation` is a human-readable string explaining it — verified by
   reading `buildSeoOpportunities` (`src/seo/intelligence.ts:106-167`), which builds each `Opportunity` from
   exactly one of `lowCtrOpportunities`, `strikingDistanceKeywords`, or `findCannibalization` and stamps the
   matching `type` and a fixed `recommendation` string per source. There is no opportunity shape with a
   missing or unattributed evidence source in the real tool output — every `Opportunity` the tool returns
   already carries its `type`.
2. **`impact`, `effort`, and `priorityScore` are all separate fields already present**, not derived
   client-side. Per `buildSeoOpportunities` (`:106-167`): for `low_ctr`, `impact = impressions`, `effort = 1`,
   `priorityScore = impressions / 1`; for `striking_distance`, `impact = impressions`, `effort = 2`,
   `priorityScore = impressions / 2`; for `cannibalization`, `impact = group.totalImpressions`, `effort = 3`,
   `priorityScore = totalImpressions / 3`. `effort` is a fixed per-type constant (1, 2, or 3), not a computed
   assessment — it is a coarse, type-level proxy, not a per-opportunity effort estimate. None of `impact`,
   `effort`, or `priorityScore` is bounded or normalized to any fixed range (e.g. 0-100); they are open-ended
   relative scores derived directly from raw impression counts, so their absolute magnitude has no fixed
   scale and is only meaningful in relative comparison against other opportunities in the same result.
3. **`CannibalGroup.pages` is already capped by the tool itself.** `findCannibalization`
   (`src/seo/intelligence.ts:46-104`) applies `MAX_PAGES_PER_GROUP = 10` (`:46`) via `.slice(0,
MAX_PAGES_PER_GROUP)` (`:93`) when building each group's `pages` array, while `pageCount` and
   `totalImpressions`/`totalClicks` are computed from the full, unsliced page set before the cap is applied
   (`:88-93`). So a group's `pages` array MAY be shorter than its own `pageCount` when a query has more than
   10 competing pages — the view inherits this bound and must not present `pages` as necessarily complete.
4. **No internal-linking recommendation exists in any of the five real tools.** Verified by reading
   `src/seo/intelligence.ts` and `src/seo/keyword-pages.ts` in full and grepping the codebase for
   `internal.?link|orphan|topLinkedPages`: the only mention of "internal links" anywhere in the synthesis
   code is a fixed, generic recommendation string on `striking_distance` opportunities — "Strengthen content
   and internal links to move from page 2 into page 1." (`src/seo/intelligence.ts:139-140`) — which is
   static text, not a reference to `linkGraph`, `orphanPages`, or `topLinkedPages` data, and is not tied to
   any specific page's link status. No tool computes a recommendation from the crawl's link graph. This
   roadmap-named intent (`ROADMAP.md`'s "internal-linking recommendations") remains genuinely UNBUILT even
   after this reconciliation; the corresponding requirement below stays PROVISIONAL, not reconciled.
5. **`analyze_domain` has a three-state GSC-enrichment shape**, not the two states ("attempted" /
   "not attempted") the original provisional spec assumed. Verified via `buildDomainReport` and
   `analyzeDomain` (`src/seo/domain-report.ts:28-102`): if `gscProperty`, `startDate`, and `endDate` were all
   supplied, `analyzeDomain` calls `findSeoOpportunities` in a `try`/`catch` (`:77-99`); on success it sets
   `search` (and leaves `gscError` unset); on failure it sets `gscError` (and leaves `search` unset). If any
   of the three GSC params was omitted, neither branch runs and neither `search` nor `gscError` appears on
   the report. The three states are therefore: (a) enrichment not requested — neither field present; (b)
   enrichment requested and succeeded — `search` present, `gscError` absent; (c) enrichment requested and
   failed — `gscError` present, `search` absent. These are mutually exclusive and exhaustive per
   `buildDomainReport` (`:34-48`), which sets at most one of the two fields.
6. **None of the five tools requires D1 (`env.DB`).** Verified by reading `src/seo/domain-report.ts`,
   `src/seo/intelligence.ts`, and `src/seo/keyword-pages.ts` in full, and grepping `src/seo/` for `env.DB`
   (no matches). All five are GSC-query-derived synthesis (via `searchConsoleQuery`) or crawl-derived
   synthesis (via `crawlSite`), the same authenticated-source class as `find_striking_distance_keywords` and
   `find_low_ctr_opportunities` — Google OAuth refresh token, NOT a D1/snapshot dependency. This capability is
   distinct from the D1/snapshot family (crawl history, snapshot diffing) that other parts of this change
   cover. Only `analyze_domain`'s crawl portion needs no auth at all (`crawl_site` has none); its optional GSC
   portion needs the Google credential per `authenticated-source-contract`.

Credential handling (Google OAuth refresh token), cache TTL class, staleness display, and quota accounting
for the GSC-backed calls within these five tools are governed by `authenticated-source-contract` and are not
restated here.

## ADDED Requirements

### Requirement: Every Recommendation Is Traceable to the Evidence That Produced It

RECONCILED — every `Opportunity` the real tools return already carries `type` (one of `"low_ctr"`,
`"striking_distance"`, `"cannibalization"`) and `recommendation` (a human-readable explanatory string). The
view MUST display both `type` and `recommendation` for every rendered opportunity, so a user can see which
underlying signal produced each recommendation. Because the real tool output attaches `type` and
`recommendation` to every opportunity unconditionally, there is no evidence-less opportunity shape to flag in
the real data; the view MUST NOT need to render an "unexplained recommendation" fallback state for
`Opportunity` results from these tools.

The view MUST also visually distinguish opportunities by `type` and MUST NOT merge or collapse the
presentation of opportunities with different `type` values into one undifferentiated list item style — for
example, a `cannibalization` opportunity's row or card MUST be visibly distinguishable from a `low_ctr` or
`striking_distance` opportunity's row or card, since a user needs to know which signal drove a given
recommendation in order to act on it correctly (a cannibalization consolidation action is a different action
than a title/meta rewrite).

#### Scenario: An opportunity shows its type and recommendation together

- GIVEN a `find_seo_opportunities` or `analyze_domain` result includes an `Opportunity`
- WHEN the view renders that opportunity
- THEN it MUST display both the `type` value and the `recommendation` text for that opportunity

#### Scenario: Opportunities of different types are visibly distinct

- GIVEN a result contains opportunities with `type` values `"low_ctr"`, `"striking_distance"`, and
  `"cannibalization"` in the same list
- WHEN a user views the list
- THEN each opportunity's `type` MUST be visually distinguishable (e.g. via a label, icon, or grouping)
  from an opportunity of a different `type`, and no two different types MUST render identically

### Requirement: Impact, Effort, and Priority Score Are All Shown, Not Only the Score

RECONCILED — `impact`, `effort`, and `priorityScore` are all separate, already-present fields on every
`Opportunity` (`src/seo/intelligence.ts:30-40`, `106-167`); none is derived by the view. The view MUST display
all three values for every rendered opportunity, not only `priorityScore`, including when the list is sorted
by `priorityScore`. None of the three fields is bounded or normalized to a fixed scale in the real tool
output — they are open-ended values derived from raw impression counts and a fixed per-type `effort`
constant (1 for `low_ctr`, 2 for `striking_distance`, 3 for `cannibalization`). The view MUST NOT present
`effort` as a fine-grained, per-opportunity computed estimate; it MUST be presented consistent with what it
actually is — a coarse, type-level constant — and MUST NOT invent or imply a normalized 0-100 or similar
scale for any of the three fields.

#### Scenario: All three fields are visible together

- GIVEN an opportunity carries `impact`, `effort`, and `priorityScore`
- WHEN the view renders that opportunity in a list
- THEN it MUST display all three values, not only `priorityScore`

#### Scenario: Sorting by priority score does not hide the other two fields

- GIVEN a user sorts the opportunity list by `priorityScore`
- WHEN the sorted list renders
- THEN each entry MUST still display its `impact` and `effort` values, not only its rank or score

#### Scenario: Effort is not presented as more granular than it is

- GIVEN `effort` is one of the fixed constants `1`, `2`, or `3` corresponding to opportunity `type`
- WHEN the view renders `effort`
- THEN it MUST NOT present the value as a precise, per-opportunity computed effort estimate or on an
  invented normalized scale

### Requirement: Cannibalization Findings Name the Competing Pages, Within the Tool's Own Bound

RECONCILED — `CannibalGroup.pages` (`CannibalPage[]`) already names each competing page directly, with its
own `clicks`, `impressions`, and `position` (`src/seo/intelligence.ts:12-25`). The view MUST render every
entry in a group's `pages` array with its page URL, clicks, impressions, and position — not a count or
summary alone.

`findCannibalization` itself caps `pages` at `MAX_PAGES_PER_GROUP = 10` per group (`src/seo/intelligence.ts:46,
93`), while `pageCount`, `totalImpressions`, and `totalClicks` are computed from the full, unsliced set before
that cap is applied. Consequently `pages.length` MAY be less than `pageCount` for a group with more than 10
competing pages. The view MUST render all pages present in the `pages` array (up to the tool's own bound,
i.e. never truncate `pages` further on the client) and, when `pages.length < pageCount`, MUST indicate that
the shown pages are a bounded subset of the group's full competing-page count, rather than presenting
`pages.length` as the group's complete competing-page count.

#### Scenario: A cannibalization finding lists its competing URLs with metrics

- GIVEN a `CannibalGroup` with a `pages` array
- WHEN the view renders that group
- THEN it MUST list every entry in `pages`, showing each page's URL, `clicks`, `impressions`, and `position`

#### Scenario: A group capped below its full page count is labeled as bounded

- GIVEN a `CannibalGroup` where `pages.length` is less than `pageCount` (more than 10 competing pages existed
  for the query)
- WHEN the view renders that group
- THEN it MUST indicate that the displayed pages are a bounded subset of `pageCount`, not the complete set

### Requirement: Internal-Linking Recommendations Remain Unbuilt

PROVISIONAL — verified across all five real tools (`analyze_domain`, `find_seo_opportunities`,
`find_keyword_cannibalization`, `map_keywords_to_pages`, `find_content_gaps`) and their underlying synthesis
code (`src/seo/intelligence.ts`, `src/seo/keyword-pages.ts`): none computes a recommendation from the crawl's
link graph (`linkGraph`, `orphanPages`, `topLinkedPages`). The only mention of "internal links" in any
synthesis output is a fixed, generic string attached to `striking_distance` opportunities
(`src/seo/intelligence.ts:139-140`) that is not derived from, or related to, any specific page's link-graph
status. The roadmap-named intent of internal-linking recommendations related to the site crawl's link graph is
therefore NOT satisfied by any shipped tool and remains fully provisional.

The view MUST NOT present the generic `striking_distance` recommendation string as if it were a link-graph-
aware internal-linking recommendation, and MUST NOT fabricate a relationship between an opportunity and
`linkGraph.orphanPages` or `linkGraph.topLinkedPages` data that the tool output does not actually establish.
This requirement remains blocked pending a real tool or synthesis function that produces link-graph-aware
recommendations; no such tool exists today.

#### Scenario: The generic striking-distance text is not misrepresented as link-graph-aware

- GIVEN a `striking_distance` opportunity's `recommendation` text mentions "internal links" as generic advice
- WHEN the view renders that opportunity
- THEN it MUST NOT present the recommendation as derived from or connected to the site crawl's actual
  `linkGraph` data (e.g. MUST NOT claim the referenced page is or is not an orphan, since the tool output
  contains no such link)

#### Scenario: True link-graph-aware recommendations remain out of scope until a tool exists

- GIVEN no shipped tool computes a recommendation from `linkGraph`, `orphanPages`, or `topLinkedPages`
- WHEN this view is implemented against the five real tools listed in this spec
- THEN it MUST NOT implement or ship a link-graph-derived recommendation feature, since no tool output
  supports it; this sub-requirement stays open for a future reconciliation once such a tool exists

### Requirement: `analyze_domain`'s GSC Enrichment Has Three Distinct States

RECONCILED — `analyze_domain`'s `DomainReport` carries at most one of `search` or `gscError`, and MAY carry
neither, producing three mutually exclusive states verified from `buildDomainReport`
(`src/seo/domain-report.ts:28-49`) and `analyzeDomain` (`:61-102`): (a) GSC enrichment was not requested
(`gscProperty`, `startDate`, or `endDate` was omitted from the call) — neither `search` nor `gscError` is
present; (b) GSC enrichment was requested and succeeded — `search` is present and `gscError` is absent; (c)
GSC enrichment was requested and failed — `gscError` is present and `search` is absent.

The view MUST render each of these three states distinctly. It MUST NOT present state (a) — enrichment simply
not requested — identically to state (c) — enrichment requested and failed. It MUST NOT present state (a) as
if GSC data were attempted at all (no error, no empty-result placeholder implying an attempted-and-empty
query). When `search` is present, the view MUST render `search.opportunities` using the opportunity
requirements above.

#### Scenario: Enrichment not requested renders no GSC section and no error

- GIVEN an `analyze_domain` call omitted `gscProperty`, `startDate`, or `endDate`
- WHEN the view renders the resulting `DomainReport`
- THEN it MUST render the crawl portion only, MUST NOT render a GSC error state, and MUST NOT render an
  empty-GSC-result state implying enrichment was attempted

#### Scenario: Enrichment requested and succeeded renders the opportunities

- GIVEN an `analyze_domain` result has `search` present (and `gscError` absent)
- WHEN the view renders the result
- THEN it MUST render `search.opportunities` using the opportunity-list requirements this spec defines,
  labeled with `search.startDate`/`search.endDate`

#### Scenario: Enrichment requested and failed renders a distinct failure state

- GIVEN an `analyze_domain` result has `gscError` present (and `search` absent)
- WHEN the view renders the result
- THEN it MUST render a GSC-enrichment failure state distinct from both the "not requested" state and a
  successful-but-empty opportunities list, and MUST route that failure through the failure-classification
  requirements `authenticated-source-contract` defines

### Requirement: Drill-Down Into the Existing Page and Site Views

RECONCILED — `analyze_domain`'s `crawl` sub-object reuses `SiteCrawlResult`'s `summary`, `crawlPolicy`, and
`linkGraph` fields directly (`src/seo/domain-report.ts:15-23`), the same shapes `site-crawl-view` already
renders and drills into. Cannibalization findings (`CannibalGroup.pages[].page`), content gaps
(`ContentGap.page`), keyword-to-page mappings (`PageKeywords.page`), and non-cannibalization opportunities
(`Opportunity.page`, when not `null`) each name a specific page URL. Where any of these reference a specific
page, the view MUST provide a drill-down action into the existing `page-report-view` for that page,
consistent with the drill-down pattern `site-crawl-view` already establishes for its own per-page table. Where
`analyze_domain`'s `crawl` data is rendered, the view MUST provide a drill-down action into `site-crawl-view`
for the whole-site crawl detail, reusing `site-crawl-view`'s existing data contract rather than duplicating
crawl-level detail inside this view.

A `cannibalization`-type `Opportunity` has `page: null` (verified: `src/seo/intelligence.ts:144-157` sets
`page: null` for every cannibalization-derived opportunity, since it summarizes a whole group rather than one
page) — the view MUST NOT offer a single-page drill-down for a `cannibalization`-type opportunity from the
`Opportunity` shape alone; a full drill-down into the competing pages requires the separate
`find_keyword_cannibalization` result's `CannibalGroup.pages`, each of which does name a specific page.

#### Scenario: A page-referencing finding opens the page report

- GIVEN a content gap, keyword-to-page mapping entry, cannibalization group page, or non-null-`page`
  opportunity references a specific page URL
- WHEN a user activates that finding's drill-down action
- THEN the view MUST open `page-report-view` for that page

#### Scenario: The domain report's crawl portion opens the site crawl view

- GIVEN an `analyze_domain` result's `crawl` sub-object is rendered
- WHEN a user activates the crawl detail's drill-down action
- THEN the view MUST open `site-crawl-view` for that domain, reusing `site-crawl-view`'s existing data
  contract

#### Scenario: A cannibalization-type opportunity does not offer a fabricated single-page drill-down

- GIVEN an `Opportunity` with `type: "cannibalization"` and `page: null`
- WHEN the view renders that opportunity from a `find_seo_opportunities` or `analyze_domain` result
- THEN it MUST NOT offer a page drill-down action derived from that opportunity's own `page` field, since it
  is `null`; a page-level drill-down for that query's competing pages requires the separate
  `find_keyword_cannibalization` result

## Required Amendments To Sibling Changes

None identified. Drill-down into `page-report-view` and `site-crawl-view` reuses the drill-down pattern
`site-crawl-view` already establishes for its own per-page table; no change to either sibling spec is needed
to support drill-down originating from this view.
