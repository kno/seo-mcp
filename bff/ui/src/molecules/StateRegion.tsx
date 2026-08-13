import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import type { BffError } from "../../../src/errors";
import type { Cardinality } from "../data/bounds";
import { presentFor } from "../data/errors";
import { Countdown } from "../atoms/Countdown";
import { Spinner } from "../atoms/Spinner";

export type RegionState =
  | {
      readonly phase: "loading";
      /**
       * Overrides the generic "Loading {label}…" text. `site-crawl-view`'s
       * long-running-crawl requirement needs an explicit "crawl in
       * progress" wording distinct from a short-lived fetch, without every
       * other view's loading text changing.
       */
      readonly detail?: string;
    }
  | { readonly phase: "error"; readonly error: BffError }
  | { readonly phase: "ready"; readonly cardinality: Cardinality };

export interface StateRegionProps {
  readonly label: string;
  readonly state: RegionState;
  /** Rendered only for the "ready" branch when the result is non-empty. */
  readonly children?: ReactNode;
}

/**
 * The loading/empty/bound/error switch every panel wraps
 * (`design.md`'s component architecture). Renders the three data states
 * the `dashboard-shell` spec requires to be mutually exclusive and
 * distinguishable by more than raw counts, plus the error branch that
 * consumes `data/errors.ts`'s exhaustive presentation table so no failure
 * path can ever present as an empty or successful result. Moves focus to
 * its own heading whenever the phase transitions away from loading, so a
 * keyboard/screen-reader user is never left on a stale or removed control.
 */
export function StateRegion({ label, state, children }: StateRegionProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const regionId = useId();
  const headingId = `${regionId}-heading`;

  useEffect(() => {
    if (state.phase !== "loading") headingRef.current?.focus();
  }, [state]);

  if (state.phase === "loading") {
    return (
      <section className="region" aria-labelledby={headingId}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {label}
        </h2>
        <p className="state-loading" role="status">
          <Spinner /> {state.detail ?? `Loading ${label}…`}
        </p>
        {/* Purely decorative placeholder rows so a long-running request
            reads as "a result is being assembled here" rather than an empty
            card. `aria-hidden` — the `role="status"` line above remains the
            single announced loading channel (`Spinner`'s contract). */}
        <div className="skeleton-stack" aria-hidden="true">
          <div className="skeleton-bar" style={{ inlineSize: "38%" }} />
          <div className="skeleton-bar" style={{ inlineSize: "82%" }} />
          <div className="skeleton-bar" style={{ inlineSize: "64%" }} />
        </div>
      </section>
    );
  }

  if (state.phase === "error") {
    const presentation = presentFor(state.error);
    return (
      <section className="region" aria-labelledby={headingId}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {label}
        </h2>
        <div className="alert" role="alert">
          <p className="alert-title">{presentation.title}</p>
          <p className="alert-description">{presentation.description}</p>
        </div>
        {presentation.retry.kind === "disabled-until-elapsed" &&
          (presentation.retry.retryAfterSeconds > 0 ? (
            <Countdown
              seconds={presentation.retry.retryAfterSeconds}
              label="Retry available in"
            />
          ) : (
            // No known retry delay (e.g. a Google quota rejection carries
            // no `retryAfter`) — per `quota-visibility`'s "a rate-limit
            // error without a retry delay is handled honestly" scenario,
            // this MUST state the limit was reached WITHOUT displaying a
            // specific wait time (0s would be a fabricated delay), and
            // MUST still avoid inviting an immediate repeated retry.
            <p className="alert-note" role="status">
              The limit was reached. No retry delay was provided by the upstream
              service.
            </p>
          ))}
      </section>
    );
  }

  const { cardinality } = state;

  if (cardinality.state === "none") {
    return (
      <section className="region" aria-labelledby={headingId}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {label}
        </h2>
        <p className="empty-state">No {label.toLowerCase()} found.</p>
      </section>
    );
  }

  return (
    <section className="region" aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1}>
        {label}
      </h2>
      {cardinality.state === "bounded" && (
        <p className="bound-indicator" data-testid="bound-indicator">
          Showing {cardinality.bound.shown} of a maximum{" "}
          {cardinality.bound.limitValue} ({cardinality.bound.limitName}).
        </p>
      )}
      {children}
    </section>
  );
}
