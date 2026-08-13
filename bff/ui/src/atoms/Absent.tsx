/**
 * Explicit indicator for a legitimately-optional field that is absent from
 * a result (e.g. no canonical link). Distinct from a blank cell or a
 * fabricated default value — `page-report-view`'s "Absent optional field
 * shows explicit absence" scenario, and the shared `Absent` primitive named
 * in `design.md`'s component architecture.
 */
export interface AbsentProps {
  readonly label?: string;
}

export function Absent({ label }: AbsentProps) {
  return (
    <span data-testid="absent">
      {label ? `${label}: not present` : "Not present"}
    </span>
  );
}
