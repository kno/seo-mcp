import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GscDiff } from "../../../../src/types";
import { SnapshotDiffPanel } from "./SnapshotDiffPanel";

const DIFF: GscDiff = {
  baseCount: 3,
  currentCount: 3,
  decayed: [
    {
      query: "mantenimiento de jardines la rioja",
      page: "https://as-jardineria.com/",
      base: { clicks: 0, impressions: 8, ctr: 0, position: 27.25 },
      current: { clicks: 0, impressions: 7, ctr: 0, position: 26.7 },
      clicksDelta: 0,
      impressionsDelta: -1,
      positionDelta: -0.5,
    },
    {
      query: "haro eclipse",
      page: "https://as-jardineria.com/2026/08/03/eclipse-solar-2026-en-haro/",
      base: { clicks: 0, impressions: 45, ctr: 0, position: 9.9 },
      current: { clicks: 0, impressions: 38, ctr: 0, position: 8.9 },
      clicksDelta: 0,
      impressionsDelta: -7,
      positionDelta: -1,
    },
  ],
  improved: [
    {
      query: "paisajismo la rioja",
      page: "https://as-jardineria.com/",
      base: { clicks: 0, impressions: 1, ctr: 0, position: 65 },
      current: { clicks: 0, impressions: 2, ctr: 0, position: 43 },
      clicksDelta: 0,
      impressionsDelta: 1,
      positionDelta: 22,
    },
  ],
  lost: [],
  gained: [
    {
      query: "piscinas de briones",
      page: "https://as-jardineria.com/",
      base: null,
      current: { clicks: 0, impressions: 1, ctr: 0, position: 11 },
      clicksDelta: 0,
      impressionsDelta: 1,
      positionDelta: 0,
    },
  ],
};

describe("SnapshotDiffPanel — page filter", () => {
  it("shows every row across all buckets when no filter is entered", () => {
    render(
      <SnapshotDiffPanel
        siteUrl="https://as-jardineria.com"
        baseSnapshotId={1}
        currentSnapshotId={2}
        diff={DIFF}
      />,
    );
    expect(
      screen.getByText(/mantenimiento de jardines la rioja/),
    ).toBeInTheDocument();
    expect(screen.getByText(/haro eclipse/)).toBeInTheDocument();
    expect(screen.getByText(/paisajismo la rioja/)).toBeInTheDocument();
    expect(screen.getByText(/piscinas de briones/)).toBeInTheDocument();
  });

  it("filters every bucket to rows whose page contains the typed text", async () => {
    const user = userEvent.setup();
    render(
      <SnapshotDiffPanel
        siteUrl="https://as-jardineria.com"
        baseSnapshotId={1}
        currentSnapshotId={2}
        diff={DIFF}
      />,
    );

    await user.type(
      screen.getByLabelText(/filter by page/i),
      "as-jardineria.com/2026/08/03/eclipse-solar-2026-en-haro/",
    );

    expect(screen.getByText(/haro eclipse/)).toBeInTheDocument();
    expect(
      screen.queryByText(/mantenimiento de jardines la rioja/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/paisajismo la rioja/)).not.toBeInTheDocument();
    expect(screen.queryByText(/piscinas de briones/)).not.toBeInTheDocument();
  });

  it("filtering to a page with no rows in a bucket shows that bucket's own empty state, not a global empty state", async () => {
    const user = userEvent.setup();
    render(
      <SnapshotDiffPanel
        siteUrl="https://as-jardineria.com"
        baseSnapshotId={1}
        currentSnapshotId={2}
        diff={DIFF}
      />,
    );

    await user.type(
      screen.getByLabelText(/filter by page/i),
      "as-jardineria.com/",
    );

    // The home page ("https://as-jardineria.com/") appears in decayed,
    // improved, and gained, but never in lost.
    expect(
      screen.getByText(/mantenimiento de jardines la rioja/),
    ).toBeInTheDocument();
    expect(screen.getByText(/paisajismo la rioja/)).toBeInTheDocument();
    expect(screen.getByText(/piscinas de briones/)).toBeInTheDocument();
    expect(screen.getByText(/No lost queries\./)).toBeInTheDocument();
  });

  it("the bound label still reflects the unfiltered bucket size, never the filtered count", async () => {
    const user = userEvent.setup();
    render(
      <SnapshotDiffPanel
        siteUrl="https://as-jardineria.com"
        baseSnapshotId={1}
        currentSnapshotId={2}
        diff={DIFF}
      />,
    );

    // decayed has 2 rows total, well under LIMITS.maxDiffRows, so no bound
    // label renders either before or after filtering — filtering must not
    // fabricate a bound that was never real.
    expect(
      screen.queryByTestId("diff-bucket-bound-decayed"),
    ).not.toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/filter by page/i),
      "eclipse-solar-2026-en-haro",
    );

    expect(
      screen.queryByTestId("diff-bucket-bound-decayed"),
    ).not.toBeInTheDocument();
  });
});
