import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoredSnapshot } from "../../../../src/types";
import { SnapshotListPanel } from "./SnapshotListPanel";

const SNAPSHOTS: StoredSnapshot[] = [
  {
    id: 1,
    siteUrl: "sc-domain:example.com",
    capturedAt: "2026-08-01T00:00:00.000Z",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    label: "first",
  },
  {
    id: 2,
    siteUrl: "sc-domain:example.com",
    capturedAt: "2026-08-05T00:00:00.000Z",
    startDate: "2026-08-01",
    endDate: "2026-08-05",
    label: "second",
  },
];

function renderPanel(
  overrides: Partial<Parameters<typeof SnapshotListPanel>[0]> = {},
) {
  const onDelete = vi.fn();
  const onSelectBase = vi.fn();
  const onSelectCurrent = vi.fn();
  const utils = render(
    <SnapshotListPanel
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

describe("SnapshotListPanel — two-click delete confirm", () => {
  it("shows 'Delete' initially and does not call onDelete on the first click", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderPanel();

    const deleteButton = screen.getByRole("button", {
      name: "Delete snapshot #1",
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
      name: "Delete snapshot #1",
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
      name: "Delete snapshot #1",
    });
    const deleteButton2 = screen.getByRole("button", {
      name: "Delete snapshot #2",
    });

    await user.click(deleteButton1);
    expect(deleteButton1).toHaveTextContent("Confirm delete?");

    await user.click(deleteButton2);
    expect(deleteButton1).toHaveTextContent("Delete");
    expect(deleteButton2).toHaveTextContent("Confirm delete?");
    expect(onDelete).not.toHaveBeenCalled();

    // A second click on row 2 (now armed) confirms only row 2.
    await user.click(deleteButton2);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(expect.anything(), 2);
  });

  it("removes a row from the rendered list when the parent locally splices it out, without a full re-fetch", () => {
    const onDelete = vi.fn();
    const onSelectBase = vi.fn();
    const onSelectCurrent = vi.fn();
    const { rerender } = render(
      <SnapshotListPanel
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

    // Simulate the parent's local list update (splice, not a re-fetch): a
    // NEW array reference with the deleted snapshot removed.
    const remaining = SNAPSHOTS.filter((s) => s.id !== 1);
    rerender(
      <SnapshotListPanel
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
      <SnapshotListPanel
        snapshots={SNAPSHOTS}
        baseSnapshotId={null}
        currentSnapshotId={null}
        onSelectBase={onSelectBase}
        onSelectCurrent={onSelectCurrent}
        onDelete={onDelete}
      />,
    );

    const deleteButton2 = screen.getByRole("button", {
      name: "Delete snapshot #2",
    });
    await user.click(deleteButton2);
    expect(deleteButton2).toHaveTextContent("Confirm delete?");

    // A fresh array (same logical contents, new reference) — e.g. a
    // refresh-list action — must reset the armed state.
    rerender(
      <SnapshotListPanel
        snapshots={[...SNAPSHOTS]}
        baseSnapshotId={null}
        currentSnapshotId={null}
        onSelectBase={onSelectBase}
        onSelectCurrent={onSelectCurrent}
        onDelete={onDelete}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Delete snapshot #2" }),
    ).toHaveTextContent("Delete");
  });
});
