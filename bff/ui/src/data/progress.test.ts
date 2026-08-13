import { describe, expect, it } from "vitest";
import { readToolResponse } from "./progress";

describe("readToolResponse", () => {
  it("resolves 'result' to the exact same value the wrapped promise resolves to", async () => {
    const envelope = {
      data: { site: "https://example.com" },
      cacheStatus: "miss",
      resultAge: 0,
    };
    const stream = readToolResponse(Promise.resolve(envelope));

    await expect(stream.result).resolves.toBe(envelope);
  });

  it("resolves 'result' to an error envelope unchanged when the wrapped promise rejects to one", async () => {
    const errorEnvelope = {
      error: { code: "bff_timeout", message: "timed out" },
    };
    const stream = readToolResponse(Promise.resolve(errorEnvelope));

    await expect(stream.result).resolves.toBe(errorEnvelope);
  });

  it("yields exactly one 'indeterminate' progress frame for today's bounded-JSON BFF surface", async () => {
    const stream = readToolResponse(
      Promise.resolve({ data: {}, cacheStatus: "miss", resultAge: 0 }),
    );

    const frames: unknown[] = [];
    for await (const frame of stream.progress) frames.push(frame);

    expect(frames).toEqual(["indeterminate"]);
  });
});
