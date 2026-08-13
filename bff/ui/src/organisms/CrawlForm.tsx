import { useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { LIMITS } from "../../../../src/config";

/**
 * `site-crawl-view`'s "Bounded Crawl Input Controls" requirement. Defaults
 * `limit` to 5 and `concurrency` to 2 — deliberately LOWER than the tool's
 * own defaults (`LIMITS.defaultCrawlPages` 10, and `crawlSiteInputSchema`'s
 * `concurrency` default of 4 in `bff/src/router.ts`), because `crawl_site`
 * is the most expensive action a dashboard user can trigger and the
 * proposal recommends a lower UI-level default than the tool's own. The
 * maximum bounds (`limit` <= 20, `concurrency` <= 4) are imported from
 * `LIMITS.maxCrawlPages`/`LIMITS.maxConcurrency` rather than hardcoded, so a
 * future change to those server-side caps cannot silently drift from this
 * form. The minimum of 1 for both fields has no corresponding named
 * constant anywhere in `src/config.ts` (the schema itself hardcodes `.min(1)`
 * for both), so it is a literal here too, matching the frozen schema it
 * mirrors.
 *
 * This is a pure, stateful (synchronous UI state only — no async state, no
 * `fetch`, no `data/client` import) organism per `design.md`'s
 * container/organism boundary. It does not mint a `UserIntent` itself
 * (that would require importing `data/client`, which organisms MUST NOT
 * do); instead it forwards the raw DOM event that triggered a valid submit
 * to `onSubmit`, so the CONTAINER can call `userIntent(event)` on a real
 * user-gesture event ("submit" for the direct below-maximum path, "click"
 * for the explicit maximum-value confirmation button — both are valid
 * gesture types per `data/client.ts`).
 */

const MIN_LIMIT = 1;
const MIN_CONCURRENCY = 1;

export interface CrawlFormInput {
  readonly url: string;
  readonly limit: number;
  readonly concurrency: number;
}

export interface CrawlFormProps {
  readonly onSubmit: (
    event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>,
    input: CrawlFormInput,
  ) => void;
  /** True while a crawl request is in flight — disables re-submission. */
  readonly disabled: boolean;
}

function isAtMaximum(limit: number, concurrency: number): boolean {
  return (
    limit === LIMITS.maxCrawlPages || concurrency === LIMITS.maxConcurrency
  );
}

export function CrawlForm({ onSubmit, disabled }: CrawlFormProps) {
  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState(5);
  const [concurrency, setConcurrency] = useState(2);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);

  function validate(): string | null {
    if (limit < MIN_LIMIT || limit > LIMITS.maxCrawlPages) {
      return `Limit must be between 1 and ${LIMITS.maxCrawlPages}.`;
    }
    if (concurrency < MIN_CONCURRENCY || concurrency > LIMITS.maxConcurrency) {
      return `Concurrency must be between 1 and ${LIMITS.maxConcurrency}.`;
    }
    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    const error = validate();
    if (error) {
      setValidationError(error);
      setPendingConfirmation(false);
      return;
    }

    if (isAtMaximum(limit, concurrency)) {
      // Distinct, deliberate confirmation step — the normal submit action
      // does NOT send the request yet.
      setPendingConfirmation(true);
      return;
    }

    onSubmit(event, { url, limit, concurrency });
  }

  function handleConfirm(event: MouseEvent<HTMLButtonElement>) {
    setPendingConfirmation(false);
    onSubmit(event, { url, limit, concurrency });
  }

  return (
    <form
      className="toolbar"
      onSubmit={handleSubmit}
      aria-label="Site crawl request"
    >
      <div className="field-row">
        <div className="field field-url">
          <label htmlFor="crawl-url">Site URL</label>
          <input
            id="crawl-url"
            name="url"
            type="url"
            placeholder="https://example.com"
            required
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="crawl-limit">Limit</label>
          <input
            id="crawl-limit"
            name="limit"
            type="number"
            value={limit}
            onChange={(event) => setLimit(Number(event.currentTarget.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="crawl-concurrency">Concurrency</label>
          <input
            id="crawl-concurrency"
            name="concurrency"
            type="number"
            value={concurrency}
            onChange={(event) =>
              setConcurrency(Number(event.currentTarget.value))
            }
          />
        </div>
      </div>

      {validationError && (
        <p className="alert" role="alert">
          {validationError}
        </p>
      )}

      {pendingConfirmation && (
        <div className="alert alert-notice" role="alert">
          <p className="alert-description">
            Running a crawl at the maximum setting can take up to 40 seconds and
            consumes the shared rate limit bucket. Confirm to continue.
          </p>
          <div className="form-actions">
            <button
              className="btn-primary"
              type="button"
              onClick={handleConfirm}
              disabled={disabled}
            >
              Confirm and run crawl
            </button>
          </div>
        </div>
      )}

      <div className="form-actions">
        <button className="btn-primary" type="submit" disabled={disabled}>
          Start crawl
        </button>
        <span className="field-hint">
          Crawling is the most expensive action here — it spends the shared
          rate-limit bucket.
        </span>
      </div>
    </form>
  );
}
