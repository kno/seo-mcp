/**
 * `gsc-insight-views`' "Shared Property and Date-Range Selection Across All
 * Three Tools" requirement (task 6.1): ONE property (`siteUrl`) selector and
 * ONE date-range selector, rendered once regardless of which of the three
 * insight sub-tools is active. `GscInsightsContainer` owns the actual state
 * (`siteUrl`/`startDate`/`endDate`) and passes it down as controlled props,
 * so switching the active tab never remounts — and therefore never resets —
 * this component; the same values simply carry over.
 *
 * This component does not itself submit anything — each sub-tool's own
 * "Run"/"Compare" control (`OpportunityCriteriaForm`, `SnapshotToolsPanel`)
 * reads these same container-owned values when building its own request,
 * and independently blocks submission when `siteUrl` is empty.
 */
export interface GscSharedSelectorProps {
  readonly siteUrl: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly onSiteUrlChange: (value: string) => void;
  readonly onStartDateChange: (value: string) => void;
  readonly onEndDateChange: (value: string) => void;
  readonly disabled: boolean;
}

export function GscSharedSelector({
  siteUrl,
  startDate,
  endDate,
  onSiteUrlChange,
  onStartDateChange,
  onEndDateChange,
  disabled,
}: GscSharedSelectorProps) {
  return (
    <fieldset
      className="toolbar field-row"
      aria-label="Site and date range (shared across insight tools)"
    >
      <div className="field field-url">
        <label htmlFor="gsc-insights-site-url">Site URL (property)</label>
        <input
          id="gsc-insights-site-url"
          name="siteUrl"
          type="text"
          placeholder="sc-domain:example.com or https://example.com/"
          required
          value={siteUrl}
          disabled={disabled}
          onChange={(event) => onSiteUrlChange(event.currentTarget.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="gsc-insights-start-date">Start date</label>
        <input
          id="gsc-insights-start-date"
          name="startDate"
          type="text"
          placeholder="YYYY-MM-DD"
          value={startDate}
          disabled={disabled}
          onChange={(event) => onStartDateChange(event.currentTarget.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="gsc-insights-end-date">End date</label>
        <input
          id="gsc-insights-end-date"
          name="endDate"
          type="text"
          placeholder="YYYY-MM-DD"
          value={endDate}
          disabled={disabled}
          onChange={(event) => onEndDateChange(event.currentTarget.value)}
        />
      </div>
    </fieldset>
  );
}
