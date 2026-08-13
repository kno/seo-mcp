/**
 * Form for `get_keyword_metrics` — `keyword-research-view`'s "the view MUST
 * be usable with only `get_keyword_metrics`" requirement (task 8.1). This
 * form has no dependency on `discover_keywords` or `cluster_keywords`; it
 * is the sole prerequisite-free entry point into the view.
 *
 * `keywords` mirrors `src/server.ts`'s `get_keyword_metrics` inputSchema
 * exactly: 1-100 keywords, required. Comma-or-newline-separated free text,
 * parsed client-side into a trimmed, de-duplicated-by-construction list
 * (the server itself does not de-duplicate, so this form does not either).
 */
import { useState } from "react";
import type { FormEvent } from "react";

export interface KeywordMetricsFormInput {
  readonly keywords: readonly string[];
  readonly geoTargetIds?: readonly string[];
  readonly languageId?: string;
  readonly customerId?: string;
}

export interface KeywordMetricsFormProps {
  readonly onSubmit: (
    event: FormEvent<HTMLFormElement>,
    input: KeywordMetricsFormInput,
  ) => void;
  readonly disabled: boolean;
}

const MAX_KEYWORDS = 100;

function parseKeywordList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function KeywordMetricsForm({
  onSubmit,
  disabled,
}: KeywordMetricsFormProps) {
  const [keywordsRaw, setKeywordsRaw] = useState("");
  const [geoTargetIds, setGeoTargetIds] = useState("");
  const [languageId, setLanguageId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keywords = parseKeywordList(keywordsRaw);
    if (keywords.length === 0) {
      setValidationError("Enter at least one keyword.");
      return;
    }
    if (keywords.length > MAX_KEYWORDS) {
      setValidationError(`Enter at most ${MAX_KEYWORDS} keywords.`);
      return;
    }
    setValidationError(null);
    onSubmit(event, {
      keywords,
      geoTargetIds:
        geoTargetIds.trim() === "" ? undefined : parseKeywordList(geoTargetIds),
      languageId: languageId.trim() === "" ? undefined : languageId.trim(),
      customerId: customerId.trim() === "" ? undefined : customerId.trim(),
    });
  }

  return (
    <form
      className="toolbar"
      onSubmit={handleSubmit}
      aria-label="Get keyword metrics"
    >
      <div className="field-row">
        <div className="field field-url">
          <label htmlFor="keyword-metrics-keywords">
            Keywords (1-100, comma or newline separated)
          </label>
          <textarea
            id="keyword-metrics-keywords"
            required
            value={keywordsRaw}
            onChange={(event) => setKeywordsRaw(event.currentTarget.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="keyword-metrics-geo-target-ids">
            Geo target IDs (optional)
          </label>
          <input
            id="keyword-metrics-geo-target-ids"
            type="text"
            placeholder="server default: 2724"
            value={geoTargetIds}
            onChange={(event) => setGeoTargetIds(event.currentTarget.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="keyword-metrics-language-id">
            Language ID (optional)
          </label>
          <input
            id="keyword-metrics-language-id"
            type="text"
            placeholder="server default: 1003"
            value={languageId}
            onChange={(event) => setLanguageId(event.currentTarget.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="keyword-metrics-customer-id">
            Customer ID (optional)
          </label>
          <input
            id="keyword-metrics-customer-id"
            type="text"
            value={customerId}
            onChange={(event) => setCustomerId(event.currentTarget.value)}
          />
        </div>
      </div>

      {validationError && (
        <p className="alert" role="alert">
          {validationError}
        </p>
      )}

      <div className="form-actions">
        <button className="btn-primary" type="submit" disabled={disabled}>
          Get keyword metrics
        </button>
        <span className="field-hint">
          Spends the independent Google Ads quota, separate from the shared MCP
          rate-limit bucket and from any Google Search Console quota.
        </span>
      </div>
    </form>
  );
}
