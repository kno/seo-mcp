import { ScoreGauge } from "../charts/ScoreGauge";

/**
 * `pagespeed-view`'s "Score Presentation for All Four Categories"
 * requirement. Each of the four `PageSpeedResult` score fields is optional;
 * an absent field renders through `ScoreGauge`'s own explicit unavailable
 * state rather than a fabricated `0`.
 */
export interface ScorePanelProps {
  readonly performanceScore?: number;
  readonly accessibilityScore?: number;
  readonly bestPracticesScore?: number;
  readonly seoScore?: number;
}

export function ScorePanel({
  performanceScore,
  accessibilityScore,
  bestPracticesScore,
  seoScore,
}: ScorePanelProps) {
  return (
    <section className="panel" aria-label="PageSpeed scores">
      <h3>Scores</h3>
      <div className="gauge-grid">
        <ScoreGauge label="Performance" score={performanceScore} />
        <ScoreGauge label="Accessibility" score={accessibilityScore} />
        <ScoreGauge label="Best Practices" score={bestPracticesScore} />
        <ScoreGauge label="SEO" score={seoScore} />
      </div>
    </section>
  );
}
