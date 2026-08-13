/**
 * `search-console-view`'s "Query Controls Match the Tool's Real Input
 * Schema Exactly" requirement: exactly `siteUrl` (free-text — there is no
 * list-properties tool, so no property dropdown/allowlist control exists),
 * `startDate`/`endDate` (`YYYY-MM-DD`), an optional dimension multi-select
 * limited to the six real enum values, and `rowLimit` (1..250). No metric
 * selector, comparison-period input, or property-discovery control is
 * offered, because `search_console_query` accepts none.
 *
 * `GSC_DIMENSIONS` mirrors `src/schemas/search-console.ts`'s
 * `gscDimensionSchema` enum values verbatim, without importing zod into
 * this project — a closed set the view renders against, matching the
 * server's own tighter type.
 */
import { useState } from "react";
import type { FormEvent } from "react";

export const GSC_DIMENSIONS = [
  "query",
  "page",
  "country",
  "device",
  "date",
  "searchAppearance",
] as const;

export type GscDimension = (typeof GSC_DIMENSIONS)[number];

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_RANGE_DAYS = 28;
const MIN_ROW_LIMIT = 1;
const MAX_ROW_LIMIT = 250;

export interface SearchConsoleFormInput {
  readonly siteUrl: string;
  readonly startDate: string;
  readonly endDate: string;
  /** Empty when the user selected none — the tool falls back to its own
   * server-side default (`["query", "page"]`), never an invented
   * client-side one. */
  readonly dimensions: readonly GscDimension[];
  readonly rowLimit?: number;
}

export interface SearchConsoleFormProps {
  readonly onSubmit: (
    event: FormEvent<HTMLFormElement>,
    input: SearchConsoleFormInput,
  ) => void;
  /** True while a query request is in flight — disables re-submission. */
  readonly disabled: boolean;
  /** Injectable clock for deterministic default-range tests; defaults to
   * `Date.now`-backed `new Date()`. */
  readonly now?: () => Date;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function subtractDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() - days);
  return copy;
}

export function SearchConsoleForm({
  onSubmit,
  disabled,
  now = () => new Date(),
}: SearchConsoleFormProps) {
  const [siteUrl, setSiteUrl] = useState("");
  const [startDate, setStartDate] = useState(() =>
    toDateOnly(subtractDays(now(), DEFAULT_RANGE_DAYS)),
  );
  const [endDate, setEndDate] = useState(() => toDateOnly(now()));
  const [dimensions, setDimensions] = useState<readonly GscDimension[]>([]);
  const [rowLimit, setRowLimit] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function toggleDimension(dimension: GscDimension) {
    setDimensions((current) =>
      current.includes(dimension)
        ? current.filter((value) => value !== dimension)
        : GSC_DIMENSIONS.filter(
            (value) => current.includes(value) || value === dimension,
          ),
    );
  }

  function validate(): string | null {
    if (
      !DATE_ONLY_PATTERN.test(startDate) ||
      !DATE_ONLY_PATTERN.test(endDate)
    ) {
      return "Start date and end date must both match YYYY-MM-DD.";
    }
    if (rowLimit.trim() !== "") {
      const parsed = Number(rowLimit);
      if (
        !Number.isInteger(parsed) ||
        parsed < MIN_ROW_LIMIT ||
        parsed > MAX_ROW_LIMIT
      ) {
        return `Row limit must be an integer between 1 and ${MAX_ROW_LIMIT}.`;
      }
    }
    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }

    onSubmit(event, {
      siteUrl,
      startDate,
      endDate,
      dimensions,
      rowLimit: rowLimit.trim() === "" ? undefined : Number(rowLimit),
    });
  }

  return (
    <form
      className="toolbar"
      onSubmit={handleSubmit}
      aria-label="Search Console query"
    >
      <div className="field-row">
        <div className="field field-url">
          <label htmlFor="gsc-site-url">Site URL (property)</label>
          <input
            id="gsc-site-url"
            name="siteUrl"
            type="text"
            placeholder="sc-domain:example.com or https://example.com/"
            required
            value={siteUrl}
            onChange={(event) => setSiteUrl(event.currentTarget.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="gsc-start-date">Start date</label>
          <input
            id="gsc-start-date"
            name="startDate"
            type="text"
            placeholder="YYYY-MM-DD"
            value={startDate}
            onChange={(event) => setStartDate(event.currentTarget.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="gsc-end-date">End date</label>
          <input
            id="gsc-end-date"
            name="endDate"
            type="text"
            placeholder="YYYY-MM-DD"
            value={endDate}
            onChange={(event) => setEndDate(event.currentTarget.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="gsc-row-limit">Row limit</label>
          <input
            id="gsc-row-limit"
            name="rowLimit"
            type="number"
            placeholder="up to 250"
            value={rowLimit}
            onChange={(event) => setRowLimit(event.currentTarget.value)}
          />
        </div>
      </div>

      <fieldset className="field-row">
        <legend>
          Dimensions (optional — defaults to query and page when none are
          selected)
        </legend>
        {GSC_DIMENSIONS.map((dimension) => (
          <label key={dimension} className="field-checkbox">
            <input
              type="checkbox"
              name="dimensions"
              checked={dimensions.includes(dimension)}
              onChange={() => toggleDimension(dimension)}
            />
            {dimension}
          </label>
        ))}
      </fieldset>

      {validationError && (
        <p className="alert" role="alert">
          {validationError}
        </p>
      )}

      <div className="form-actions">
        <button className="btn-primary" type="submit" disabled={disabled}>
          Run query
        </button>
        <span className="field-hint">
          Every query spends the independent Google Search Console quota,
          separate from the shared MCP rate-limit bucket.
        </span>
      </div>
    </form>
  );
}
