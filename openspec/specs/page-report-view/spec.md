# Page Report View

## Purpose

Renders a `crawl_page` result (`PageAnalysis`) as a scannable report: on-page metadata,
headings, link counts, Open Graph, JSON-LD, word count, and the analyzer's issues list.

## Requirements

### Requirement: On-Page Card Shows Core Metadata With Explicit Absence

The on-page card MUST display `title`, `description`, `canonical`, `robots`, `lang`, and
indexability (`indexable`, derived from `robots` and HTTP `status`). For any of `canonical`,
`robots`, or `lang` that is absent from the result (the field is legitimately optional in
`PageSignals`), the card MUST show an explicit "not present" indicator rather than a blank cell
or a fabricated default value.

#### Scenario: All fields present render their values

- GIVEN a `PageAnalysis` with `title`, `description`, `canonical`, `robots`, and `lang` all set
- WHEN the on-page card renders
- THEN every field MUST display its actual value

#### Scenario: Absent optional field shows explicit absence

- GIVEN a `PageAnalysis` where `canonical` is `undefined`
- WHEN the on-page card renders
- THEN the canonical field MUST show an explicit "not present" indicator, not an empty string or a fabricated URL

### Requirement: Headings and Link Counts Are Shown Separately by Level and Direction

The view MUST render `h1`, `h2`, and `h3` as separate lists, and MUST show `internalLinks` and
`externalLinks` as two distinct counts, never merged into one total.

#### Scenario: Multiple H1 headings are all listed

- GIVEN a `PageAnalysis` whose `h1` array has two entries
- WHEN the headings view renders
- THEN both H1 entries MUST be visible, distinguishable from H2 and H3 entries

#### Scenario: Internal and external link counts are separate

- GIVEN `internalLinks: 12` and `externalLinks: 3`
- WHEN the view renders link counts
- THEN it MUST show 12 and 3 as two separate figures, not a combined 15

### Requirement: Open Graph and JSON-LD Panels Show Presence, Types, and Invalid Blocks

The Open Graph panel MUST list the `openGraph` key/value pairs present, or an explicit
"no Open Graph metadata" state when the map is empty. The JSON-LD panel MUST show `jsonLd.blocks`
found, the distinct `jsonLd.types` detected, and MUST separately flag when `jsonLd.invalid > 0`
that one or more blocks failed to parse, without treating an invalid block as if it contributed
a type.

#### Scenario: No Open Graph metadata is explicit

- GIVEN `openGraph` is an empty object
- WHEN the Open Graph panel renders
- THEN it MUST show an explicit "no Open Graph metadata" state, not a blank panel indistinguishable from a loading state

#### Scenario: Invalid JSON-LD block is flagged

- GIVEN `jsonLd: { blocks: 2, types: ["Article"], invalid: 1 }`
- WHEN the JSON-LD panel renders
- THEN it MUST show 1 block flagged invalid alongside the 1 valid, typed block, and MUST NOT report 2 valid types

### Requirement: Word Count Is Shown as a Single Figure

The view MUST display `wordCount` as reported by the analyzer, with no client-side recomputation
from other fields.

#### Scenario: Word count renders the analyzer's value

- GIVEN `wordCount: 180`
- WHEN the view renders
- THEN it MUST display 180, unmodified

### Requirement: Issues List Covers Exactly the Analyzer's Real Codes and Severities

The issues list MUST render every issue in `PageAnalysis.issues`, and MUST map each of the
thirteen codes `detectSeoIssues` can emit — `missing_title`, `title_length`,
`missing_description`, `description_length`, `missing_h1`, `multiple_h1`, `missing_canonical`,
`missing_lang`, `images_missing_alt`, `noindex`, `invalid_jsonld`, `missing_open_graph`,
`thin_content` — to a defined presentation using that issue's own `severity` (`warning` or
`info`) as emitted by the analyzer. The view MUST NOT invent, rename, or reclassify a code or
severity not produced by `detectSeoIssues`, and MUST NOT default an unrecognized future code to
a hidden or silently-dropped state — an unrecognized code MUST still render with its raw code,
message, and severity.

#### Scenario: Warning-severity issue is visually distinct from info

- GIVEN issues `[{code: "missing_title", severity: "warning", ...}, {code: "thin_content", severity: "info", ...}]`
- WHEN the issues list renders
- THEN the two entries MUST use visually distinct severity indicators matching `warning` and `info`

#### Scenario: Empty issues list means zero detected, not analysis failure

- GIVEN `PageAnalysis.issues` is an empty array from a successful `crawl_page` call
- WHEN the issues list renders
- THEN it MUST show an explicit "no issues detected" state, distinguishable from the state shown when the page could not be analyzed at all

### Requirement: Analysis Failure Is Distinct From a Clean Report

When the underlying `crawl_page` request fails (normalized error, per `dashboard-shell`), the
report view MUST render the shared error-state contract for the whole report, and MUST NOT
render any card, panel, or issues list as if a zero-issue or empty analysis had succeeded.

#### Scenario: Failed crawl shows the error state, not an empty report

- GIVEN a `crawl_page` request fails with a normalized error
- WHEN the page report view renders
- THEN it MUST show the shared error-state presentation for that error's code
- AND MUST NOT render the on-page card, headings, or issues list as if data existed
