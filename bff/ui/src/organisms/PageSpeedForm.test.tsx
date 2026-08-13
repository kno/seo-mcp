import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PageSpeedForm } from "./PageSpeedForm";

describe("PageSpeedForm", () => {
  it("defaults the strategy selector to mobile", () => {
    render(<PageSpeedForm onSubmit={vi.fn()} disabled={false} />);
    expect(screen.getByLabelText(/strategy/i)).toHaveValue("mobile");
  });

  it("blocks submission when the URL input is empty", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PageSpeedForm onSubmit={onSubmit} disabled={false} />);

    await user.click(screen.getByRole("button", { name: /analyze/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("submits the URL and strategy when the URL is present", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PageSpeedForm onSubmit={onSubmit} disabled={false} />);

    await user.type(screen.getByLabelText(/page url/i), "https://example.com");
    await user.click(screen.getByRole("button", { name: /analyze/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [, input] = onSubmit.mock.calls[0];
    expect(input.url).toBe("https://example.com");
    expect(input.strategy).toBe("mobile");
    expect(input.apiKey).toBeUndefined();
  });

  it("wraps a typed API key in a SecretCell rather than forwarding a raw string", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PageSpeedForm onSubmit={onSubmit} disabled={false} />);

    await user.type(screen.getByLabelText(/page url/i), "https://example.com");
    await user.type(screen.getByLabelText(/api key/i), "my-real-key");
    await user.click(screen.getByRole("button", { name: /analyze/i }));

    const [, input] = onSubmit.mock.calls[0];
    expect(input.apiKey).toBeDefined();
    expect(typeof input.apiKey).not.toBe("string");
    expect(input.apiKey.take()).toBe("my-real-key");
  });

  it("never holds the API key value in React state (uncontrolled input)", async () => {
    const user = userEvent.setup();
    render(<PageSpeedForm onSubmit={vi.fn()} disabled={false} />);
    const apiKeyInput = screen.getByLabelText(/api key/i) as HTMLInputElement;
    await user.type(apiKeyInput, "my-real-key");
    // An uncontrolled input has no `value` prop bound to React state; the
    // DOM element's own value is the only place it lives.
    expect(apiKeyInput).not.toHaveAttribute("value");
    expect(apiKeyInput.value).toBe("my-real-key");
  });
});
