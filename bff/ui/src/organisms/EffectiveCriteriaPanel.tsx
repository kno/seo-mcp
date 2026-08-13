import { GSC_PULL_CAVEAT } from "../../../src/authenticated/criteria";

/**
 * `seo-intelligence-view`'s (PR10) shared "applied criteria" + unconditional
 * GSC-pull caveat block (tasks 10.1/10.3). `criteria` is the BFF-echoed
 * EFFECTIVE (post-default-resolution) object — `basis: "request"`, textually
 * distinct from `OpportunityResult.criteria` (`OpportunityCriteriaForm`'s
 * view, PR6), which the TOOL itself echoes without a `basis` field at all.
 * The caveat renders unconditionally, for every one of the five tools,
 * always — never inferred from a response field, because none exists that
 * would let a caller infer it (task 10.3).
 */
export interface EffectiveCriteriaPanelProps {
  readonly criteria: Readonly<Record<string, number | string>>;
}

export function EffectiveCriteriaPanel({
  criteria,
}: EffectiveCriteriaPanelProps) {
  const fields = Object.entries(criteria).filter(([key]) => key !== "basis");

  return (
    <div
      className="panel"
      aria-label="Applied criteria"
      data-testid="effective-criteria-panel"
    >
      <h3>Applied criteria</h3>
      <p className="field-hint" data-testid="criteria-basis">
        Effective criteria resolved by the dashboard (basis: {criteria.basis}) —
        an omitted field below shows the server's own default.
      </p>
      <dl className="stat-grid">
        {fields.map(([key, value]) => (
          <div className="stat" key={key}>
            <dt>{key}</dt>
            <dd data-testid={`criteria-${key}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="field-hint" data-testid="gsc-pull-caveat">
        {GSC_PULL_CAVEAT}
      </p>
    </div>
  );
}
