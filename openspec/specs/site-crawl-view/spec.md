# Site Crawl View

## Requirements

### Requirement: Bounded Crawl Input Controls

The `crawl_site` view MUST provide `limit` and `concurrency` controls that cannot submit values outside the tool's accepted ranges (`limit` 1-20, `concurrency` 1-4). The view MUST default `limit` to 5 and `concurrency` to 2. Any value at or near the maximum (`limit` 20 or `concurrency` 4) MUST require an explicit, warned confirmation step before submission, naming the worst-case latency (approximately 40 seconds) and that the request consumes the shared rate-limit bucket.

#### Scenario: Default values are the low-cost defaults

- GIVEN a user opens the `crawl_site` view for the first time
- WHEN the input controls render
- THEN `limit` MUST default to 5 and `concurrency` MUST default to 2

#### Scenario: Out-of-range values cannot be submitted

- GIVEN a user attempts to set `limit` to a value greater than 20 or less than 1, or `concurrency` to a value greater than 4 or less than 1
- WHEN the user attempts to submit the crawl request
- THEN the view MUST prevent submission and MUST NOT send the out-of-range value to the BFF

#### Scenario: Maximum values require explicit warned confirmation

- GIVEN a user sets `limit` to 20 or `concurrency` to 4
- WHEN the user attempts to submit the crawl request
- THEN the view MUST present a warning naming the approximate 40-second worst-case latency and the shared rate-limit bucket
- AND MUST require an explicit confirmation action distinct from the normal submit action before the request is sent

#### Scenario: Below-maximum values submit without the warning step

- GIVEN a user sets `limit` and `concurrency` to values below their respective maximums
- WHEN the user submits the crawl request
- THEN the view MUST submit without requiring the maximum-value confirmation step

### Requirement: Domain Summary Panel Reflects the Real Result Shape

The view MUST render a domain summary panel sourced from `SiteCrawlResult.summary` (`DomainSummary`), presenting: `pagesAnalyzed`, `duplicateTitles`, `duplicateDescriptions` (each a list of `{ value, count, sample }` groups), `missingH1`, `multipleH1`, `thinContent`, `nonIndexable` (each a `{ count, sample }` category), and `imagesMissingAlt` (`{ pages, images }`). The panel MUST NOT introduce fields absent from `DomainSummary`.

#### Scenario: Duplicate groups show value, count and sample

- GIVEN `summary.duplicateTitles` contains one or more duplicate groups
- WHEN the domain summary panel renders
- THEN each group MUST display its shared `value`, its `count` of affected pages, and its `sample` of URLs

#### Scenario: Category counts render even when zero

- GIVEN `summary.missingH1.count` is 0
- WHEN the domain summary panel renders
- THEN the missing-H1 category MUST display a count of 0 rather than being omitted from the panel

#### Scenario: Images-without-alt coverage shows both page and image counts

- GIVEN `summary.imagesMissingAlt` reports `{ pages: 3, images: 12 }`
- WHEN the domain summary panel renders
- THEN it MUST display both the number of affected pages (3) and the total number of images missing `alt` text (12)

### Requirement: Crawl Policy Panel Reflects the Real Result Shape

The view MUST render a crawl policy panel sourced from `SiteCrawlResult.crawlPolicy` (`CrawlPolicy`), presenting: whether `robotsFound`, the declared `sitemapsDeclared` list, and the `disallowedSkipped` count and sample of URLs excluded by robots rules.

#### Scenario: Robots not found is shown distinctly from robots found

- GIVEN `crawlPolicy.robotsFound` is `false`
- WHEN the crawl policy panel renders
- THEN it MUST indicate that no robots.txt was found, and MUST NOT render the same state as when robots.txt was found and permitted everything

#### Scenario: Disallowed-skipped count and sample are both shown

- GIVEN `crawlPolicy.disallowedSkipped` reports `{ count: 7, sample: [...] }`
- WHEN the crawl policy panel renders
- THEN it MUST display the count (7) and the sample URLs, and MUST label the sample as a sample when the count exceeds the sample's length

### Requirement: Internal Link Graph Shows Orphans and Most-Linked Pages

The view MUST render the internal link graph sourced from `SiteCrawlResult.linkGraph` (`LinkGraphSummary`), presenting the count of crawled pages considered (`crawledPages`), the orphan pages category (`orphanPages`: `{ count, sample }`), and the most-linked pages list (`topLinkedPages`: `Array<{ url, inbound }>`). The visualization mechanism for `topLinkedPages` is unspecified by this requirement; only the underlying data and its correctness are in scope.

#### Scenario: Zero orphan pages is shown as a positive finding

- GIVEN `linkGraph.orphanPages.count` is 0
- WHEN the link graph panel renders
- THEN it MUST display that no orphan pages were found, distinct from any truncated or empty-result state

#### Scenario: Most-linked pages show inbound counts

- GIVEN `linkGraph.topLinkedPages` contains entries with `url` and `inbound`
- WHEN the link graph panel renders
- THEN each entry MUST display its URL and its inbound link count, ordered as returned by the result

### Requirement: Per-Page Table With Drill-Down

The view MUST render a per-page table from `SiteCrawlResult.pages`, showing for each entry either its issue count (derived from `result.issues` when `result` is present) or its crawl error (when `error` is present instead of `result`). Each successfully crawled row MUST provide a drill-down action that opens the `page-report-view` for that page's data.

#### Scenario: Failed page shows its error, not a fabricated issue count

- GIVEN a page entry has `error` set and no `result`
- WHEN the per-page table renders that row
- THEN it MUST display the crawl error message and MUST NOT display an issue count for that row

#### Scenario: Successfully crawled row opens the page report

- GIVEN a page entry has `result` set
- WHEN a user activates that row's drill-down action
- THEN the view MUST open the page report view populated with that page's `result` data, without issuing a new `crawl_page` request when the data needed is already present in the current `crawl_site` result

### Requirement: Bound-Versus-Empty Distinction Across All Panels

Every panel drawing on a capped or sampled field (`duplicateTitles`, `duplicateDescriptions`, `missingH1.sample`, `multipleH1.sample`, `thinContent.sample`, `nonIndexable.sample`, `crawlPolicy.disallowedSkipped.sample`, `crawlPolicy.sitemapsDeclared`, `linkGraph.orphanPages.sample`, `linkGraph.topLinkedPages`) MUST label that field as a sample whenever the field's `count` (or, where no explicit count exists, the underlying total) exceeds the number of items actually shown. A count of 0 for any such category MUST render as an explicit "none found" state, never identical to a state where data could not be determined.

#### Scenario: A capped sample is labeled as a sample

- GIVEN `summary.duplicateTitles` contains a group whose `count` is 15 but whose `sample` contains only 10 URLs
- WHEN the domain summary panel renders that group
- THEN it MUST label the displayed URLs as a sample and MUST NOT present them as the complete list of affected pages

#### Scenario: An uncapped result is not mislabeled as a sample

- GIVEN a category's `count` equals the number of items in its `sample`
- WHEN the relevant panel renders that category
- THEN it MUST NOT display a sample label implying more items exist than are shown

#### Scenario: Output-byte truncation is surfaced independently of any single panel's sample labels

- GIVEN `SiteCrawlResult.outputBytes` is at or near `maxSiteOutputBytes` (256,000 bytes) and `crawled` plus `failed` is less than `requested`
- WHEN the view renders the crawl result
- THEN the view MUST surface that the crawl may have been bounded by the output-size cap, distinct from and in addition to any per-category sample labels

### Requirement: Long-Running Crawl Shows Progress or an Honest Indeterminate State

While a `crawl_site` request is in flight, the view MUST show either determinate progress (if the BFF surface in use reports incremental progress) or an explicit indeterminate-but-in-progress state. In either case the view MUST NOT allow the in-flight request to visually resemble a hang: it MUST disable resubmission of the same request while in flight and MUST communicate that work is ongoing.

#### Scenario: Bounded-response BFF shows an indeterminate in-progress state

- GIVEN the BFF returns `crawl_site` results only as a single bounded response with no incremental progress signal
- WHEN a crawl request is in flight
- THEN the view MUST display an explicit "crawl in progress" indeterminate state rather than a static or frozen-looking UI

#### Scenario: Streaming-progress BFF shows determinate progress

- GIVEN the BFF surface reports incremental progress for an in-flight `crawl_site` request (e.g. via server-sent events)
- WHEN a crawl request is in flight
- THEN the view MUST display determinate progress reflecting that signal

#### Scenario: Resubmission is blocked while a crawl is in flight

- GIVEN a `crawl_site` request for a given site is in flight
- WHEN the user attempts to submit another `crawl_site` request for the same site before the first completes
- THEN the view MUST prevent the duplicate submission until the in-flight request resolves or fails
