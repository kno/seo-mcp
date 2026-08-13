import type { ReactNode } from "react";
import { Absent } from "../atoms/Absent";

/**
 * `pagespeed-view`'s "Lab Metrics Presentation" requirement. Every field on
 * `PageSpeedResult.labMetrics` is optional; an absent metric renders `Absent`
 * rather than a `0` or blank cell, and a genuine `0` (e.g.
 * `cumulativeLayoutShift: 0`) renders as `0`, never conflated with absence —
 * the `undefined` check (not a falsy check) is what keeps those two cases
 * distinct.
 */
export interface LabMetrics {
  readonly firstContentfulPaintMs?: number;
  readonly largestContentfulPaintMs?: number;
  readonly totalBlockingTimeMs?: number;
  readonly cumulativeLayoutShift?: number;
  readonly speedIndexMs?: number;
}

export interface LabMetricsPanelProps {
  readonly labMetrics: LabMetrics;
}

function renderMetric(
  label: string,
  value: number | undefined,
  unit: string,
): ReactNode {
  return (
    <>
      <dt>{label}</dt>
      <dd data-testid={`lab-metric-${label}`}>
        {value === undefined ? <Absent label={label} /> : `${value}${unit}`}
      </dd>
    </>
  );
}

export function LabMetricsPanel({ labMetrics }: LabMetricsPanelProps) {
  return (
    <dl aria-label="Lab metrics">
      {renderMetric(
        "First Contentful Paint",
        labMetrics.firstContentfulPaintMs,
        " ms",
      )}
      {renderMetric(
        "Largest Contentful Paint",
        labMetrics.largestContentfulPaintMs,
        " ms",
      )}
      {renderMetric(
        "Total Blocking Time",
        labMetrics.totalBlockingTimeMs,
        " ms",
      )}
      {renderMetric(
        "Cumulative Layout Shift",
        labMetrics.cumulativeLayoutShift,
        "",
      )}
      {renderMetric("Speed Index", labMetrics.speedIndexMs, " ms")}
    </dl>
  );
}
