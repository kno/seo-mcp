import { Absent } from "../atoms/Absent";

/**
 * Hand-rolled inline SVG circular gauge for a single Lighthouse category
 * score (`pagespeed-view`'s "Score Presentation for All Four Categories"
 * requirement), per `design.md`'s no-charting-library decision — mirrors
 * `charts/BarChart.tsx`'s precedent of layering `aria-hidden` SVG decoration
 * over a real accessible text value rather than relying on the SVG alone.
 * `score` is `undefined` when the category is absent from `PageSpeedResult`
 * (e.g. a Lighthouse audit ran without collecting that category); it MUST
 * render as an explicit unavailable state, never a fabricated `0`, and a
 * genuine reported `0` MUST be visually and textually distinct from that
 * absence.
 */
export interface ScoreGaugeProps {
  readonly label: string;
  readonly score?: number;
}

const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreGauge({ label, score }: ScoreGaugeProps) {
  if (score === undefined) {
    return (
      <div data-testid={`gauge-${label}`}>
        <p>{label}</p>
        <Absent label={`${label} score`} />
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(100, score));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div data-testid={`gauge-${label}`}>
      <p>{label}</p>
      <svg aria-hidden="true" viewBox="0 0 100 100" width="80" height="80">
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={10}
        />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={10}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 50 50)"
        />
      </svg>
      {/* The gauge band must be legible from text alone, per design.md's
          accessibility unit test note — the SVG above is decorative only. */}
      <p>{clamped}</p>
    </div>
  );
}
