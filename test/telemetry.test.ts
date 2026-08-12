import { afterEach, describe, expect, it, vi } from "vitest";
import { logRequestMetrics } from "../src/http/telemetry";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logRequestMetrics", () => {
  it("logs a single request_metrics JSON line with the given fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logRequestMetrics({ path: "/mcp", status: 200, durationMs: 42 });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(payload).toEqual({
      kind: "request_metrics",
      path: "/mcp",
      status: 200,
      durationMs: 42,
    });
  });
});
