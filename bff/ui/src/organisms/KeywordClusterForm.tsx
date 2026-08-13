/**
 * Form for `cluster_keywords` — pure text analysis, no Google Ads call, no
 * credential, no quota (`keyword-research-view`'s reconciliation notes).
 * Additive to `get_keyword_metrics`/`discover_keywords`, never a
 * prerequisite — usable on any keyword list a user has, independent of any
 * Ads call (task 8.4's scenario "Clustering works without an Ads call").
 */
import { useState } from "react";
import type { FormEvent } from "react";

export interface KeywordClusterFormInput {
  readonly keywords: readonly string[];
}

export interface KeywordClusterFormProps {
  readonly onSubmit: (
    event: FormEvent<HTMLFormElement>,
    input: KeywordClusterFormInput,
  ) => void;
  readonly disabled: boolean;
  /** Pre-fills the textarea, e.g. from a prior `discover_keywords` result —
   * the view MAY let a user cluster a discovery result's keywords. */
  readonly initialKeywords?: readonly string[];
}

const MAX_KEYWORDS = 500;

function parseKeywordList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function KeywordClusterForm({
  onSubmit,
  disabled,
  initialKeywords,
}: KeywordClusterFormProps) {
  const [keywordsRaw, setKeywordsRaw] = useState(
    () => initialKeywords?.join(", ") ?? "",
  );
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
    onSubmit(event, { keywords });
  }

  return (
    <form
      className="toolbar"
      onSubmit={handleSubmit}
      aria-label="Cluster keywords"
    >
      <div className="field-row">
        <div className="field field-url">
          <label htmlFor="keyword-cluster-keywords">
            Keywords (1-500, comma or newline separated)
          </label>
          <textarea
            id="keyword-cluster-keywords"
            required
            value={keywordsRaw}
            onChange={(event) => setKeywordsRaw(event.currentTarget.value)}
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
          Cluster keywords
        </button>
        <span className="field-hint">
          Pure text analysis — no Google Ads call, no credential, and no quota
          spent by this action.
        </span>
      </div>
    </form>
  );
}
