import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GSC_DIMENSIONS, SearchConsoleForm } from "./SearchConsoleForm";

const FIXED_NOW = () => new Date("2026-08-13T00:00:00.000Z");

describe("SearchConsoleForm — controls match the real input schema exactly", () => {
  it("offers exactly siteUrl, startDate, endDate, a dimension multi-select, and rowLimit — nothing else", () => {
    render(
      <SearchConsoleForm onSubmit={vi.fn()} disabled={false} now={FIXED_NOW} />,
    );

    expect(screen.getByLabelText(/site url|property/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/start date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/end date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/row limit/i)).toBeInTheDocument();

    for (const dimension of GSC_DIMENSIONS) {
      expect(
        screen.getByRole("checkbox", { name: dimension }),
      ).toBeInTheDocument();
    }
    // No metric selector, no comparison-period input, no property-discovery
    // control — the tool accepts no such input (there is no list-properties
    // tool).
    expect(screen.queryByLabelText(/metric/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/compare/i)).not.toBeInTheDocument();
  });

  it("defaults the date range to the last 28 days", () => {
    render(
      <SearchConsoleForm onSubmit={vi.fn()} disabled={false} now={FIXED_NOW} />,
    );
    expect(screen.getByLabelText(/start date/i)).toHaveValue("2026-07-16");
    expect(screen.getByLabelText(/end date/i)).toHaveValue("2026-08-13");
  });

  it("submits siteUrl, startDate, endDate with no dimensions and no rowLimit when the user changes nothing else", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchConsoleForm
        onSubmit={onSubmit}
        disabled={false}
        now={FIXED_NOW}
      />,
    );

    await user.type(
      screen.getByLabelText(/site url|property/i),
      "sc-domain:example.com",
    );
    await user.click(screen.getByRole("button", { name: /run query/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-07-16",
      endDate: "2026-08-13",
      dimensions: [],
      rowLimit: undefined,
    });
  });

  it("submits every checked dimension, in the enum's own order", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchConsoleForm
        onSubmit={onSubmit}
        disabled={false}
        now={FIXED_NOW}
      />,
    );

    await user.type(
      screen.getByLabelText(/site url|property/i),
      "https://example.com/",
    );
    await user.click(screen.getByRole("checkbox", { name: "country" }));
    await user.click(screen.getByRole("checkbox", { name: "query" }));
    await user.click(screen.getByRole("button", { name: /run query/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dimensions: ["query", "country"] }),
    );
  });

  it("rejects a start or end date that doesn't match YYYY-MM-DD before submitting", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchConsoleForm
        onSubmit={onSubmit}
        disabled={false}
        now={FIXED_NOW}
      />,
    );

    await user.type(
      screen.getByLabelText(/site url|property/i),
      "https://example.com/",
    );
    const startDate = screen.getByLabelText(/start date/i);
    await user.clear(startDate);
    await user.type(startDate, "13-08-2026");
    await user.click(screen.getByRole("button", { name: /run query/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/yyyy-mm-dd/i);
  });

  it("rejects a rowLimit outside 1..250, matching the server's own clamp", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchConsoleForm
        onSubmit={onSubmit}
        disabled={false}
        now={FIXED_NOW}
      />,
    );

    await user.type(
      screen.getByLabelText(/site url|property/i),
      "https://example.com/",
    );
    const rowLimit = screen.getByLabelText(/row limit/i);
    await user.clear(rowLimit);
    await user.type(rowLimit, "251");
    await user.click(screen.getByRole("button", { name: /run query/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/250/);
  });

  it("submits a valid rowLimit as a number", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchConsoleForm
        onSubmit={onSubmit}
        disabled={false}
        now={FIXED_NOW}
      />,
    );

    await user.type(
      screen.getByLabelText(/site url|property/i),
      "https://example.com/",
    );
    const rowLimit = screen.getByLabelText(/row limit/i);
    await user.clear(rowLimit);
    await user.type(rowLimit, "100");
    await user.click(screen.getByRole("button", { name: /run query/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rowLimit: 100 }),
    );
  });

  it("disables the submit control while a request is in flight", () => {
    render(
      <SearchConsoleForm onSubmit={vi.fn()} disabled={true} now={FIXED_NOW} />,
    );
    expect(screen.getByRole("button", { name: /run query/i })).toBeDisabled();
  });
});
