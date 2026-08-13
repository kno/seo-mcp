import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Countdown } from "./Countdown";

describe("Countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the initial remaining seconds with the given label", () => {
    render(<Countdown seconds={60} label="Retry available in" />);
    expect(screen.getByText("Retry available in 60s")).toBeInTheDocument();
  });

  it("ticks down by one second at a time and updates the visible text", () => {
    render(<Countdown seconds={3} label="Retry available in" />);
    expect(screen.getByText("Retry available in 3s")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("Retry available in 2s")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("Retry available in 1s")).toBeInTheDocument();
  });

  it("calls onElapsed exactly once when the countdown reaches zero", () => {
    const onElapsed = vi.fn();
    render(
      <Countdown
        seconds={1}
        label="Retry available in"
        onElapsed={onElapsed}
      />,
    );

    act(() => vi.advanceTimersByTime(1000));
    expect(onElapsed).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("announces itself politely for assistive technology", () => {
    render(<Countdown seconds={5} label="Retry available in" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Retry available in 5s",
    );
  });
});
