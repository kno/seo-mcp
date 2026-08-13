/**
 * Form for `discover_keywords` — additive to `get_keyword_metrics`, never a
 * prerequisite for it (task 8.1). Mirrors `src/server.ts`'s
 * `discover_keywords` inputSchema: `seedKeywords` and/or `seedUrl` (at least
 * one required — enforced by `discoverKeywords` itself, `src/google/ads.ts`,
 * so this form validates only that at least one is non-empty before
 * enabling submission, without duplicating the tool's own error text),
 * optional `geoTargetIds`/`languageId`/`limit` (1-200)/`customerId`.
 */
import { useState } from "react";
import type { FormEvent } from "react";

export interface KeywordDiscoveryFormInput {
  readonly seedKeywords?: readonly string[];
  readonly seedUrl?: string;
  readonly geoTargetIds?: readonly string[];
  readonly languageId?: string;
  readonly limit?: number;
  readonly customerId?: string;
}

export interface KeywordDiscoveryFormProps {
  readonly onSubmit: (
    event: FormEvent<HTMLFormElement>,
    input: KeywordDiscoveryFormInput,
  ) => void;
  readonly disabled: boolean;
}

function parseKeywordList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function KeywordDiscoveryForm({
  onSubmit,
  disabled,
}: KeywordDiscoveryFormProps) {
  const [seedKeywordsRaw, setSeedKeywordsRaw] = useState("");
  const [seedUrl, setSeedUrl] = useState("");
  const [geoTargetIds, setGeoTargetIds] = useState("");
  const [languageId, setLanguageId] = useState("");
  const [limit, setLimit] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const hasSeedKeywords = seedKeywordsRaw.trim() !== "";
  const hasSeedUrl = seedUrl.trim() !== "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasSeedKeywords && !hasSeedUrl) {
      setValidationError(
        "Provide at least one of seed keywords or a seed URL.",
      );
      return;
    }
    setValidationError(null);
    onSubmit(event, {
      seedKeywords: hasSeedKeywords
        ? parseKeywordList(seedKeywordsRaw)
        : undefined,
      seedUrl: hasSeedUrl ? seedUrl.trim() : undefined,
      geoTargetIds:
        geoTargetIds.trim() === "" ? undefined : parseKeywordList(geoTargetIds),
      languageId: languageId.trim() === "" ? undefined : languageId.trim(),
      limit: limit.trim() === "" ? undefined : Number(limit),
      customerId: customerId.trim() === "" ? undefined : customerId.trim(),
    });
  }

  return (
    <form
      className="toolbar"
      onSubmit={handleSubmit}
      aria-label="Discover keywords"
    >
      <div className="field-row">
        <div className="field field-url">
          <label htmlFor="keyword-discovery-seed-keywords">
            Seed keywords (comma or newline separated)
          </label>
          <textarea
            id="keyword-discovery-seed-keywords"
            value={seedKeywordsRaw}
            onChange={(event) => setSeedKeywordsRaw(event.currentTarget.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="keyword-discovery-seed-url">Seed URL</label>
          <input
            id="keyword-discovery-seed-url"
            type="text"
            value={seedUrl}
            onChange={(event) => setSeedUrl(event.currentTarget.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="keyword-discovery-limit">Limit</label>
          <input
            id="keyword-discovery-limit"
            type="number"
            placeholder="server default: 50, max 200"
            value={limit}
            onChange={(event) => setLimit(event.currentTarget.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="keyword-discovery-geo-target-ids">
            Geo target IDs (optional)
          </label>
          <input
            id="keyword-discovery-geo-target-ids"
            type="text"
            value={geoTargetIds}
            onChange={(event) => setGeoTargetIds(event.currentTarget.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="keyword-discovery-language-id">
            Language ID (optional)
          </label>
          <input
            id="keyword-discovery-language-id"
            type="text"
            value={languageId}
            onChange={(event) => setLanguageId(event.currentTarget.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="keyword-discovery-customer-id">
            Customer ID (optional)
          </label>
          <input
            id="keyword-discovery-customer-id"
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
        <button
          className="btn-primary"
          type="submit"
          disabled={disabled || (!hasSeedKeywords && !hasSeedUrl)}
        >
          Discover keywords
        </button>
        {!hasSeedKeywords && !hasSeedUrl && (
          <span className="field-hint" role="status">
            Provide seed keywords or a seed URL before running this tool.
          </span>
        )}
      </div>
    </form>
  );
}
