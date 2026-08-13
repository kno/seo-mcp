import { Absent } from "../atoms/Absent";

/**
 * On-page metadata card (`page-report-view`'s "On-Page Card Shows Core
 * Metadata With Explicit Absence" requirement). `title`/`description` are
 * always-present strings per `PageSignals`; `canonical`/`robots`/`lang` are
 * legitimately optional and render `Absent` rather than a blank cell or a
 * fabricated value when missing. Pure presentational component — no data
 * fetching, per `design.md`'s organism/atom boundary.
 */
export interface OnPageCardProps {
  readonly title: string;
  readonly description: string;
  readonly canonical?: string;
  readonly robots?: string;
  readonly lang?: string;
  readonly indexable: boolean;
}

export function OnPageCard({
  title,
  description,
  canonical,
  robots,
  lang,
  indexable,
}: OnPageCardProps) {
  return (
    <dl aria-label="On-page metadata">
      <dt>Title</dt>
      <dd>{title}</dd>

      <dt>Description</dt>
      <dd>{description}</dd>

      <dt>Canonical</dt>
      <dd data-testid="onpage-canonical">
        {canonical ?? <Absent label="canonical" />}
      </dd>

      <dt>Robots</dt>
      <dd data-testid="onpage-robots">{robots ?? <Absent label="robots" />}</dd>

      <dt>Language</dt>
      <dd data-testid="onpage-lang">{lang ?? <Absent label="lang" />}</dd>

      <dt>Indexability</dt>
      <dd data-testid="onpage-indexable">
        {indexable ? "Indexable" : "Not indexable"}
      </dd>
    </dl>
  );
}
