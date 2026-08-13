import { useState } from "react";
import type { FormEvent } from "react";

/**
 * Optional-threshold input for `find_striking_distance_keywords` and
 * `find_low_ctr_opportunities` (`gsc-insight-views`). Every field here is
 * OPTIONAL — leaving one blank means "let the server apply its own
 * default", which is exactly the value the result's echoed `criteria` will
 * later show (`OpportunityCriteriaPanel`'s "Applied Criteria Are Shown
 * Alongside Results" requirement, task 6.2). This form never guesses or
 * hardcodes a default value itself.
 *
 * Submission is blocked (task 6.1's "an unselected property blocks
 * submission for any of the three tools") whenever the shared `siteUrl` the
 * container passes down is empty — this form has no property field of its
 * own, since `GscSharedSelector` owns that value.
 */
export type OpportunityToolName =
  "find_striking_distance_keywords" | "find_low_ctr_opportunities";

export interface OpportunityCriteriaInput {
  readonly minPosition?: number;
  readonly maxPosition?: number;
  readonly minImpressions?: number;
  readonly maxCtr?: number;
  readonly limit?: number;
}

export interface OpportunityCriteriaFormProps {
  readonly tool: OpportunityToolName;
  readonly siteUrl: string;
  readonly onSubmit: (
    event: FormEvent<HTMLFormElement>,
    input: OpportunityCriteriaInput,
  ) => void;
  readonly disabled: boolean;
}

function parseOptionalNumber(raw: string): number | undefined {
  return raw.trim() === "" ? undefined : Number(raw);
}

export function OpportunityCriteriaForm({
  tool,
  siteUrl,
  onSubmit,
  disabled,
}: OpportunityCriteriaFormProps) {
  const [minPosition, setMinPosition] = useState("");
  const [maxPosition, setMaxPosition] = useState("");
  const [minImpressions, setMinImpressions] = useState("");
  const [maxCtr, setMaxCtr] = useState("");
  const [limit, setLimit] = useState("");

  const label =
    tool === "find_striking_distance_keywords"
      ? "Find striking-distance keywords"
      : "Find low-CTR opportunities";
  const runLabel =
    tool === "find_striking_distance_keywords"
      ? "Find striking-distance keywords"
      : "Find low-CTR opportunities";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (siteUrl.trim() === "") return;
    onSubmit(event, {
      ...(tool === "find_striking_distance_keywords"
        ? { minPosition: parseOptionalNumber(minPosition) }
        : {}),
      maxPosition: parseOptionalNumber(maxPosition),
      minImpressions: parseOptionalNumber(minImpressions),
      ...(tool === "find_low_ctr_opportunities"
        ? { maxCtr: parseOptionalNumber(maxCtr) }
        : {}),
      limit: parseOptionalNumber(limit),
    });
  }

  return (
    <form className="toolbar" onSubmit={handleSubmit} aria-label={label}>
      <div className="field-row">
        {tool === "find_striking_distance_keywords" && (
          <div className="field">
            <label htmlFor={`${tool}-min-position`}>Min position</label>
            <input
              id={`${tool}-min-position`}
              type="number"
              placeholder="server default: 11"
              value={minPosition}
              onChange={(event) => setMinPosition(event.currentTarget.value)}
            />
          </div>
        )}
        <div className="field">
          <label htmlFor={`${tool}-max-position`}>Max position</label>
          <input
            id={`${tool}-max-position`}
            type="number"
            placeholder={
              tool === "find_striking_distance_keywords"
                ? "server default: 20"
                : "server default: 10"
            }
            value={maxPosition}
            onChange={(event) => setMaxPosition(event.currentTarget.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${tool}-min-impressions`}>Min impressions</label>
          <input
            id={`${tool}-min-impressions`}
            type="number"
            placeholder={
              tool === "find_striking_distance_keywords"
                ? "server default: 1"
                : "server default: 10"
            }
            value={minImpressions}
            onChange={(event) => setMinImpressions(event.currentTarget.value)}
          />
        </div>
        {tool === "find_low_ctr_opportunities" && (
          <div className="field">
            <label htmlFor={`${tool}-max-ctr`}>Max CTR</label>
            <input
              id={`${tool}-max-ctr`}
              type="number"
              step="0.01"
              placeholder="server default: 0.02"
              value={maxCtr}
              onChange={(event) => setMaxCtr(event.currentTarget.value)}
            />
          </div>
        )}
        <div className="field">
          <label htmlFor={`${tool}-limit`}>Limit</label>
          <input
            id={`${tool}-limit`}
            type="number"
            placeholder="server default: 25"
            value={limit}
            onChange={(event) => setLimit(event.currentTarget.value)}
          />
        </div>
      </div>
      <div className="form-actions">
        <button
          className="btn-primary"
          type="submit"
          disabled={disabled || siteUrl.trim() === ""}
        >
          {runLabel}
        </button>
        {siteUrl.trim() === "" && (
          <span className="field-hint" role="status">
            Enter a site URL above before running this tool.
          </span>
        )}
      </div>
    </form>
  );
}
