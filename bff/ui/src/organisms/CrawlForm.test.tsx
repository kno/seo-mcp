import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CrawlForm } from "./CrawlForm";

describe("CrawlForm", () => {
  it("defaults limit to 5 and concurrency to 2", () => {
    render(<CrawlForm onSubmit={vi.fn()} disabled={false} />);
    expect(screen.getByLabelText(/limit/i)).toHaveValue(5);
    expect(screen.getByLabelText(/concurrency/i)).toHaveValue(2);
  });

  it("submits directly, with no confirmation step, for below-maximum values", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CrawlForm onSubmit={onSubmit} disabled={false} />);

    await user.type(screen.getByLabelText(/site url/i), "https://example.com");
    await user.click(screen.getByRole("button", { name: /start crawl/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), {
      url: "https://example.com",
      limit: 5,
      concurrency: 2,
    });
  });

  it("blocks submission and does not call onSubmit when limit is set above the maximum of 20", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CrawlForm onSubmit={onSubmit} disabled={false} />);

    await user.type(screen.getByLabelText(/site url/i), "https://example.com");
    const limitInput = screen.getByLabelText(/limit/i);
    await user.clear(limitInput);
    await user.type(limitInput, "21");
    await user.click(screen.getByRole("button", { name: /start crawl/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/between 1 and 20/i);
  });

  it("blocks submission and does not call onSubmit when concurrency is set below the minimum of 1", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CrawlForm onSubmit={onSubmit} disabled={false} />);

    await user.type(screen.getByLabelText(/site url/i), "https://example.com");
    const concurrencyInput = screen.getByLabelText(/concurrency/i);
    await user.clear(concurrencyInput);
    await user.type(concurrencyInput, "0");
    await user.click(screen.getByRole("button", { name: /start crawl/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/between 1 and 4/i);
  });

  it("requires an explicit confirmation step naming the ~40s latency before submitting at the maximum limit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CrawlForm onSubmit={onSubmit} disabled={false} />);

    await user.type(screen.getByLabelText(/site url/i), "https://example.com");
    const limitInput = screen.getByLabelText(/limit/i);
    await user.clear(limitInput);
    await user.type(limitInput, "20");
    await user.click(screen.getByRole("button", { name: /start crawl/i }));

    // The normal submit action must NOT have submitted yet.
    expect(onSubmit).not.toHaveBeenCalled();
    const warning = screen.getByText(/40 seconds?/i);
    expect(warning).toHaveTextContent(/shared rate limit/i);

    const confirmButton = screen.getByRole("button", {
      name: /confirm.*crawl/i,
    });
    await user.click(confirmButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), {
      url: "https://example.com",
      limit: 20,
      concurrency: 2,
    });
  });

  it("requires the same confirmation step at the maximum concurrency of 4", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CrawlForm onSubmit={onSubmit} disabled={false} />);

    await user.type(screen.getByLabelText(/site url/i), "https://example.com");
    const concurrencyInput = screen.getByLabelText(/concurrency/i);
    await user.clear(concurrencyInput);
    await user.type(concurrencyInput, "4");
    await user.click(screen.getByRole("button", { name: /start crawl/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /confirm.*crawl/i }),
    ).toBeInTheDocument();
  });

  it("disables the submit control while a request is in flight", () => {
    render(<CrawlForm onSubmit={vi.fn()} disabled={true} />);
    expect(screen.getByRole("button", { name: /start crawl/i })).toBeDisabled();
  });
});
