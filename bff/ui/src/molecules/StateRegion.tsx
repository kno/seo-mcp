import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import type { BffError } from "../../../src/errors";
import type { Cardinality } from "../data/bounds";
import { presentFor } from "../data/errors";
import { Countdown } from "../atoms/Countdown";
import { Spinner } from "../atoms/Spinner";

export type RegionState =
  | { readonly phase: "loading" }
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
      <section aria-labelledby={headingId}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {label}
        </h2>
        <p role="status">
          <Spinner /> Loading {label}…
        </p>
      </section>
    );
  }

  if (state.phase === "error") {
    const presentation = presentFor(state.error);
    return (
      <section aria-labelledby={headingId}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {label}
        </h2>
        <div role="alert">
          <p>{presentation.title}</p>
          <p>{presentation.description}</p>
        </div>
        {presentation.retry.kind === "disabled-until-elapsed" && (
          <Countdown
            seconds={presentation.retry.retryAfterSeconds}
            label="Retry available in"
          />
        )}
      </section>
    );
  }

  const { cardinality } = state;

  if (cardinality.state === "none") {
    return (
      <section aria-labelledby={headingId}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {label}
        </h2>
        <p>No {label.toLowerCase()} found.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1}>
        {label}
      </h2>
      {cardinality.state === "bounded" && (
        <p data-testid="bound-indicator">
          Showing {cardinality.bound.shown} of a maximum{" "}
          {cardinality.bound.limitValue} ({cardinality.bound.limitName}).
        </p>
      )}
      {children}
    </section>
  );
}
