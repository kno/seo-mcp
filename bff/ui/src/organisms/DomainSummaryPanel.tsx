import type {
  DomainCategory,
  DomainSummary,
  DuplicateGroup,
} from "../../../../src/types";
import { describeCategory } from "../data/bounds";
import { SampleBadge } from "../molecules/SampleBadge";

/**
 * `site-crawl-view`'s "Domain Summary Panel Reflects the Real Result Shape"
 * requirement. Renders exactly the fields `DomainSummary` publishes — no
 * invented fields. Every capped category renders its count even when 0
 * (`describeCategory` maps `count === 0` to `"none"`, rendered here as an
 * explicit "None found" rather than omitting the row), and every truncated
 * sample is labeled via the shared `SampleBadge`/`describeCategory` pair —
 * the same mechanism `broken-links-view` established, reused rather than
 * reinvented for this view's different field shapes.
 */
export interface DomainSummaryPanelProps {
  readonly summary: DomainSummary;
}

const DUPLICATE_GROUP_SAMPLE_CAP = 10;
const DOMAIN_CATEGORY_SAMPLE_CAP = 25;

function DuplicateGroupList({
  title,
  groups,
  scopePrefix,
}: {
  readonly title: string;
  readonly groups: readonly DuplicateGroup[];
  readonly scopePrefix: string;
}) {
  return (
    <div>
      <h3>{title}</h3>
      {groups.length === 0 ? (
        <p>None found.</p>
      ) : (
        <ul>
          {groups.map((group, index) => (
            <li key={`${group.value}-${index}`}>
              <strong>{group.value}</strong> — {group.count} page(s)
              <ul>
                {group.sample.map((url) => (
                  <li key={url}>{url}</li>
                ))}
              </ul>
              <SampleBadge
                cardinality={describeCategory(
                  group,
                  "DuplicateGroup.sample",
                  DUPLICATE_GROUP_SAMPLE_CAP,
                  `${scopePrefix}[${index}].sample`,
                )}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryRow({
  testId,
  label,
  category,
  scope,
}: {
  readonly testId: string;
  readonly label: string;
  readonly category: DomainCategory;
  readonly scope: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd data-testid={testId}>{category.count}</dd>
      {category.count > 0 && (
        <>
          <ul>
            {category.sample.map((url) => (
              <li key={url}>{url}</li>
            ))}
          </ul>
          <SampleBadge
            cardinality={describeCategory(
              category,
              "DomainCategory.sample",
              DOMAIN_CATEGORY_SAMPLE_CAP,
              scope,
            )}
          />
        </>
      )}
    </div>
  );
}

export function DomainSummaryPanel({ summary }: DomainSummaryPanelProps) {
  return (
    <section aria-label="Domain summary">
      <p data-testid="pages-analyzed">
        Pages analyzed: {summary.pagesAnalyzed}
      </p>

      <DuplicateGroupList
        title="Duplicate titles"
        groups={summary.duplicateTitles}
        scopePrefix="summary.duplicateTitles"
      />
      <DuplicateGroupList
        title="Duplicate descriptions"
        groups={summary.duplicateDescriptions}
        scopePrefix="summary.duplicateDescriptions"
      />

      <dl>
        <CategoryRow
          testId="missing-h1-count"
          label="Missing H1"
          category={summary.missingH1}
          scope="summary.missingH1"
        />
        <CategoryRow
          testId="multiple-h1-count"
          label="Multiple H1"
          category={summary.multipleH1}
          scope="summary.multipleH1"
        />
        <CategoryRow
          testId="thin-content-count"
          label="Thin content"
          category={summary.thinContent}
          scope="summary.thinContent"
        />
        <CategoryRow
          testId="non-indexable-count"
          label="Non-indexable"
          category={summary.nonIndexable}
          scope="summary.nonIndexable"
        />
      </dl>

      <div>
        <h3>Images missing alt text</h3>
        <dl>
          <dt>Pages</dt>
          <dd data-testid="images-missing-alt-pages">
            {summary.imagesMissingAlt.pages}
          </dd>
          <dt>Images</dt>
          <dd data-testid="images-missing-alt-images">
            {summary.imagesMissingAlt.images}
          </dd>
        </dl>
      </div>
    </section>
  );
}
