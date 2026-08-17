import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoredCrawlSnapshot } from "../../../../src/types";
import { CrawlSnapshotListPanel } from "./CrawlSnapshotListPanel";

const SNAPSHOTS: StoredCrawlSnapshot[] = [
  {
    id: 1,
    url: "https://example.com",
    capturedAt: "2026-08-01T00:00:00.000Z",
    label: "first",
    crawled: 5,
    failed: 0,
    issueCounts: {},
  },
  {
    id: 2,
    url: "https://example.com",
    capturedAt: "2026-08-05T00:00:00.000Z",
    label: "second",
    crawled: 6,
    failed: 1,
    issueCounts: {},
  },
];

function renderPanel(
  overrides: Partial<Parameters<typeof CrawlSnapshotListPanel>[0]> = {},
) {
  const onDelete = vi.fn();
  const onSelectBase = vi.fn();
  const onSelectCurrent = vi.fn();
  const utils = render(
    <CrawlSnapshotListPanel
      snapshots={SNAPSHOTS}
      baseSnapshotId={null}
      currentSnapshotId={null}
      onSelectBase={onSelectBase}
      onSelectCurrent={onSelectCurrent}
      onDelete={onDelete}
      {...overrides}
    />,
  );
  return { ...utils, onDelete, onSelectBase, onSelectCurrent };
}

describe("CrawlSnapshotListPanel — two-click delete confirm", () => {
  it("shows 'Delete' initially and does not call onDelete on the first click", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderPanel();

    const deleteButton = screen.getByRole("button", {
      name: "Delete crawl snapshot #1",
    });
    expect(deleteButton).toHaveTextContent("Delete");

    await user.click(deleteButton);

    expect(deleteButton).toHaveTextContent("Confirm delete?");
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("calls onDelete with the id on the second click of the SAME armed row", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderPanel();

    const deleteButton = screen.getByRole("button", {
      name: "Delete crawl snapshot #1",
    });
    await user.click(deleteButton);
    await user.click(deleteButton);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it("resets a different row's armed state when another row's delete is clicked first", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderPanel();

    const deleteButton1 = screen.getByRole("button", {
      name: "Delete crawl snapshot #1",
    });
    const deleteButton2 = screen.getByRole("button", {
      name: "Delete crawl snapshot #2",
    });

    await user.click(deleteButton1);
    expect(deleteButton1).toHaveTextContent("Confirm delete?");

    await user.click(deleteButton2);
    expect(deleteButton1).toHaveTextContent("Delete");
    expect(deleteButton2).toHaveTextContent("Confirm delete?");
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(deleteButton2);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(expect.anything(), 2);
  });

  it("removes a row from the rendered list when the parent locally splices it out, without a full re-fetch", () => {
    const onDelete = vi.fn();
    const onSelectBase = vi.fn();
    const onSelectCurrent = vi.fn();
    const { rerender } = render(
      <CrawlSnapshotListPanel
        snapshots={SNAPSHOTS}
        baseSnapshotId={null}
        currentSnapshotId={null}
        onSelectBase={onSelectBase}
        onSelectCurrent={onSelectCurrent}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();

    const remaining = SNAPSHOTS.filter((s) => s.id !== 1);
    rerender(
      <CrawlSnapshotListPanel
        snapshots={remaining}
        baseSnapshotId={null}
        currentSnapshotId={null}
        onSelectBase={onSelectBase}
        onSelectCurrent={onSelectCurrent}
        onDelete={onDelete}
      />,
    );

    expect(screen.queryByText("#1")).not.toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
  });

  it("resets any armed row when the snapshots array reference changes (fresh fetch/local update)", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onSelectBase = vi.fn();
    const onSelectCurrent = vi.fn();
    const { rerender } = render(
      <CrawlSnapshotListPanel
        snapshots={SNAPSHOTS}
        baseSnapshotId={null}
        currentSnapshotId={null}
        onSelectBase={onSelectBase}
        onSelectCurrent={onSelectCurrent}
        onDelete={onDelete}
      />,
    );

    const deleteButton2 = screen.getByRole("button", {
      name: "Delete crawl snapshot #2",
    });
    await user.click(deleteButton2);
    expect(deleteButton2).toHaveTextContent("Confirm delete?");

    rerender(
      <CrawlSnapshotListPanel
        snapshots={[...SNAPSHOTS]}
        baseSnapshotId={null}
        currentSnapshotId={null}
        onSelectBase={onSelectBase}
        onSelectCurrent={onSelectCurrent}
        onDelete={onDelete}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Delete crawl snapshot #2" }),
    ).toHaveTextContent("Delete");
  });
});
