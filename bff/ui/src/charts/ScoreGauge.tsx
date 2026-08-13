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

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Lighthouse's own three score bands (0–49 poor, 50–89 average, 90–100 good).
 * The band drives BOTH the arc colour and the card's fill, so the same
 * three-way distinction survives a monochrome print or a colour-blind
 * reader — the numeral itself is always present and is the authoritative
 * channel.
 */
function bandFor(score: number): "poor" | "average" | "good" {
  if (score >= 90) return "good";
  if (score >= 50) return "average";
  return "poor";
}

export function ScoreGauge({ label, score }: ScoreGaugeProps) {
  if (score === undefined) {
    return (
      <div className="gauge gauge-empty" data-testid={`gauge-${label}`}>
        <p className="gauge-label">{label}</p>
        <span className="gauge-absent">
          <Absent label={`${label} score`} />
        </span>
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(100, score));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div
      className={`gauge gauge-${bandFor(clamped)}`}
      data-testid={`gauge-${label}`}
    >
      <div className="gauge-visual">
        <svg aria-hidden="true" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.16}
            strokeWidth={8}
          />
          <circle
            className="gauge-arc"
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform="rotate(-90 50 50)"
          />
        </svg>
        {/* The gauge band must be legible from text alone, per design.md's
            accessibility unit test note — the SVG above is decorative only.
            This paragraph's only text child is the numeral itself, so a
            genuine `0` stays queryable as exactly "0". */}
        <p className="gauge-value">{clamped}</p>
      </div>
      <p className="gauge-label">{label}</p>
    </div>
  );
}
