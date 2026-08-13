import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { SecretCell } from "../data/secret";

/**
 * `pagespeed-view`'s "URL and Strategy Input" requirement, plus the
 * "PageSpeed API Key Is Never Persisted or Echoed" requirement's UI-side
 * half. Every field is read from its DOM element via a `ref` at submit
 * time — none is bound through `useState` — so this is a genuinely
 * uncontrolled form. This matters most for the `apiKey` field: a
 * `useState`-held string would appear in a React DevTools component
 * snapshot on every keystroke and could leak into a future accidental
 * `console.log` of component state; an uncontrolled input never enters
 * React state at all. The raw value is read exactly once, immediately
 * wrapped in a `SecretCell` (never held as a plain string by this
 * component afterward), and handed to `onSubmit` — the container decides
 * what to do with the cell (forward it to `requestTool`'s `secrets`
 * option) without this form ever knowing.
 *
 * Per design.md's container/organism boundary this component does not
 * import `data/client` and does not mint a `UserIntent` itself; it forwards
 * the raw `submit` event to `onSubmit`.
 */
export interface PageSpeedFormInput {
  readonly url: string;
  readonly strategy: "mobile" | "desktop";
  readonly apiKey?: SecretCell;
}

export interface PageSpeedFormProps {
  readonly onSubmit: (
    event: FormEvent<HTMLFormElement>,
    input: PageSpeedFormInput,
  ) => void;
  readonly disabled: boolean;
}

export function PageSpeedForm({ onSubmit, disabled }: PageSpeedFormProps) {
  const urlRef = useRef<HTMLInputElement>(null);
  const strategyRef = useRef<HTMLSelectElement>(null);
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const url = urlRef.current?.value.trim() ?? "";
    if (!url) {
      setValidationError("A URL is required.");
      return;
    }
    setValidationError(null);

    const strategy: "mobile" | "desktop" =
      strategyRef.current?.value === "desktop" ? "desktop" : "mobile";

    const rawApiKey = apiKeyRef.current?.value ?? "";
    const apiKey =
      rawApiKey.length > 0 ? SecretCell.from(rawApiKey) : undefined;

    onSubmit(event, { url, strategy, apiKey });
  }

  return (
    <form
      className="toolbar"
      onSubmit={handleSubmit}
      aria-label="PageSpeed analysis request"
    >
      <div className="field-row">
        <div className="field field-url">
          <label htmlFor="pagespeed-url">Page URL</label>
          {/* No `required` attribute: the browser's native constraint
              validation would silently swallow the submit event before this
              handler ever runs, so the "submission without a URL is blocked"
              behavior is enforced explicitly in `handleSubmit` below instead. */}
          <input
            id="pagespeed-url"
            name="url"
            type="url"
            placeholder="https://example.com/page"
            ref={urlRef}
          />
        </div>

        <div className="field">
          <label htmlFor="pagespeed-strategy">Strategy</label>
          <select
            id="pagespeed-strategy"
            name="strategy"
            ref={strategyRef}
            defaultValue="mobile"
          >
            <option value="mobile">Mobile</option>
            <option value="desktop">Desktop</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="pagespeed-api-key">
            PageSpeed API key (optional)
          </label>
          <input
            id="pagespeed-api-key"
            name="apiKey"
            type="password"
            autoComplete="off"
            ref={apiKeyRef}
          />
          <p className="field-hint">Never stored, never echoed back.</p>
        </div>
      </div>

      {validationError && (
        <p className="alert" role="alert">
          {validationError}
        </p>
      )}

      <div className="form-actions">
        <button className="btn-primary" type="submit" disabled={disabled}>
          Analyze
        </button>
      </div>
    </form>
  );
}
