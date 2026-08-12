# Delta for SEO Intelligence View

## PROVISIONAL — reconciliation required before shipping

This spec covers two unbuilt tools, `analyze_domain` and `find_seo_opportunities`, and the synthesized
outputs `ROADMAP.md` attributes to them: keyword-to-page mapping, content gaps, cannibalizations,
internal-linking recommendations, and impact/effort prioritization. Neither tool has an implementation, a
registered MCP tool, or a published output schema. No field name, score scale, or recommendation-object
shape below is asserted as known; each requirement states an invariant that MUST hold once the real shape
lands, not a description of that shape.

Per the `authenticated-source-contract` capability's reconciliation gate: this spec MUST be reconciled
against each tool's real output schema before that tool's part of the view ships. `analyze_domain` and
`find_seo_opportunities` MAY reconcile and ship independently of each other, and the sub-outputs listed
above (content gaps, cannibalizations, internal-linking, prioritization) MAY reconcile incrementally as
the real shape reveals which of them a given tool actually returns.

Unlike `gsc-insight-views` and `keyword-research-view`, this view is a **synthesized/derived** output, not
a direct read of an upstream data source. Its defining requirement, distinct from the other two
provisional views, is provenance: every recommendation must be traceable to the evidence that produced
it.

## ADDED Requirements

### Requirement: Every Recommendation Is Traceable to the Evidence That Produced It

Whatever recommendation shape `analyze_domain` or `find_seo_opportunities` returns, the view MUST let a
user see which underlying evidence produced each individual recommendation — for example, which
crawled pages, which query/page pairs, or which detected condition led to it — rather than presenting a
recommendation as a bare instruction with no visible basis. A recommendation whose evidence cannot be
shown MUST NOT be rendered as if it were actionable in the same way as one that can.

#### Scenario: A recommendation names its supporting evidence

- GIVEN a reconciled recommendation is rendered
- WHEN a user inspects that recommendation
- THEN the view MUST show the underlying evidence (the pages, queries, or condition) that produced it

#### Scenario: An unexplained recommendation is flagged, not hidden

- GIVEN the reconciled tool shape includes a recommendation with no attached evidence
- WHEN the view renders that recommendation
- THEN it MUST visibly mark it as lacking supporting evidence, and MUST NOT present it with the same
  confidence as an evidence-backed recommendation

### Requirement: Impact/Effort Prioritization Exposes Its Inputs, Not Only a Score

If the reconciled shape includes an impact/effort prioritization score or ranking, the view MUST show the
inputs that produced that score (at minimum, the separate impact and effort assessments that were
combined) alongside the score, rather than showing only the final number or rank with no visible basis
for it.

#### Scenario: A prioritization score shows its impact and effort components

- GIVEN a reconciled recommendation carries a combined impact/effort score
- WHEN the view renders that recommendation in its prioritized list
- THEN it MUST also show the separate impact and effort inputs that produced the score

#### Scenario: Sorting by score does not hide the components

- GIVEN a user sorts the recommendation list by priority score
- WHEN the sorted list renders
- THEN each entry MUST still display its impact and effort inputs, not only its rank

### Requirement: Cannibalization Findings Name the Competing Pages

Whatever shape a cannibalization finding takes, the view MUST identify the specific competing pages
involved in that finding by name (URL or path), not only report that cannibalization exists for a given
query or keyword without naming which pages compete.

#### Scenario: A cannibalization finding lists its competing URLs

- GIVEN a reconciled cannibalization finding for a query
- WHEN the view renders that finding
- THEN it MUST list the specific competing page URLs involved, not a count or summary alone

### Requirement: Internal-Linking Recommendations Relate to the Existing Site Crawl's Link Graph

`site-crawl-view` already renders an internal link graph (`crawledPages`, `orphanPages`,
`topLinkedPages`) from `crawl_site`. Any internal-linking recommendation this view renders MUST be
presented in relation to that existing link graph data (for example, identifying a page the
recommendation targets as one already known to be an orphan, or as absent from `topLinkedPages`) rather
than as an independent, unrelated recommendation that duplicates or contradicts the site crawl's own
findings without acknowledging them.

#### Scenario: A recommendation for an orphan page references its orphan status

- GIVEN a page identified in `site-crawl-view`'s link graph as an orphan
- WHEN an internal-linking recommendation targets that same page
- THEN the view MUST relate the recommendation to that page's already-known orphan status, rather than
  presenting the recommendation without reference to the existing crawl finding

### Requirement: Drill-Down Into the Existing Page and Site Views

Where a recommendation, cannibalization finding, or content gap references a specific page or the whole
site, the view MUST provide a drill-down action into the existing `page-report-view` (for a specific page)
or `site-crawl-view` (for the whole site), reusing those views' existing data contracts rather than
duplicating page- or site-level detail inside this view.

#### Scenario: A finding referencing one page opens the page report

- GIVEN a cannibalization finding or content gap references a specific page
- WHEN a user activates that finding's drill-down action
- THEN the view MUST open `page-report-view` for that page

#### Scenario: A finding referencing the whole site opens the site crawl view

- GIVEN a recommendation references site-wide structure rather than one page
- WHEN a user activates that recommendation's drill-down action
- THEN the view MUST open `site-crawl-view` for the relevant site

## Required Amendments To Sibling Changes

None identified. Drill-down into `page-report-view` and `site-crawl-view` reuses the drill-down pattern
`site-crawl-view` already establishes for its own per-page table; no change to either sibling spec is
needed to support drill-down originating from this view.
