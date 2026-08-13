import { Badge } from "../atoms/Badge";
import type { BadgeVariant } from "../atoms/Badge";

/**
 * Issues list (`page-report-view`'s "Issues List Covers Exactly the
 * Analyzer's Real Codes and Severities" requirement). `ISSUE_TITLES` maps
 * exactly the 13 codes `detectSeoIssues` (`src/seo/analyze.ts`) can emit to
 * a friendly title, verified directly against that source file. Severity
 * ALWAYS comes from the issue's own `severity` field, never from this
 * table or any hardcoded reclassification — the view must not invent or
 * reclassify a severity `detectSeoIssues` did not emit. A code absent from
 * `ISSUE_TITLES` (an unrecognized future code) still renders with its raw
 * `code`, `message`, and reported `severity`, marked `unmapped` — never
 * hidden or dropped, mirroring `data/errors.ts`'s unmapped-fallback
 * pattern for the shell's error codes.
 */
const ISSUE_TITLES: Readonly<Record<string, string>> = {
  missing_title: "Missing title",
  title_length: "Title length",
  missing_description: "Missing meta description",
  description_length: "Meta description too long",
  missing_h1: "Missing H1",
  multiple_h1: "Multiple H1 headings",
  missing_canonical: "Missing canonical link",
  missing_lang: "Missing lang attribute",
  images_missing_alt: "Images missing alt text",
  noindex: "Marked noindex",
  invalid_jsonld: "Invalid JSON-LD",
  missing_open_graph: "Missing Open Graph metadata",
  thin_content: "Thin content",
};

export interface IssueLike {
  readonly code: string;
  readonly severity: "warning" | "info";
  readonly message: string;
}

export interface IssuesListProps {
  readonly issues: readonly IssueLike[];
}

function badgeVariantFor(severity: "warning" | "info"): BadgeVariant {
  return severity;
}

export function IssuesList({ issues }: IssuesListProps) {
  if (issues.length === 0) {
    return (
      <section className="panel" aria-label="Issues">
        <h3>Issues</h3>
        <p className="empty-state empty-state-ok">No issues detected.</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Issues">
      <div className="panel-head">
        <h3>Issues</h3>
        <p className="panel-subtitle">
          <span className="metric-inline">{issues.length}</span> detected
        </p>
      </div>
      <ul className="item-list">
        {issues.map((issue, index) => {
          const title = ISSUE_TITLES[issue.code];
          const isUnmapped = title === undefined;
          return (
            <li className="item-row" key={`${issue.code}-${index}`}>
              <Badge variant={badgeVariantFor(issue.severity)}>
                {issue.severity}
              </Badge>
              {isUnmapped && (
                <span className="item-title" data-testid="issue-unmapped">
                  Unrecognized issue code: <code>{issue.code}</code>
                </span>
              )}
              {!isUnmapped && <strong className="item-title">{title}</strong>}
              <span className="item-detail">{issue.message}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
