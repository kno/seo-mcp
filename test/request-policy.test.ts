import { describe, expect, it } from "vitest";
import { validateMcpRequest } from "../src/http/request-policy";

describe("validateMcpRequest", () => {
  it("allows non-browser clients without Origin", () => {
    expect(
      validateMcpRequest(new Request("https://worker.example/mcp")),
    ).toBeUndefined();
  });

  it("allows same-origin browser and local Wrangler requests", () => {
    expect(
      validateMcpRequest(
        new Request("https://worker.example/mcp", {
          headers: { origin: "https://worker.example" },
        }),
      ),
    ).toBeUndefined();
    expect(
      validateMcpRequest(
        new Request("http://localhost:8787/mcp", {
          headers: { origin: "http://localhost:8787" },
        }),
      ),
    ).toBeUndefined();
  });

  it("rejects mismatched Host and cross-origin browser requests", () => {
    expect(
      validateMcpRequest(
        new Request("https://worker.example/mcp", {
          headers: { host: "attacker.example" },
        }),
      )?.status,
    ).toBe(403);
    expect(
      validateMcpRequest(
        new Request("https://worker.example/mcp", {
          headers: { origin: "https://attacker.example" },
        }),
      )?.status,
    ).toBe(403);
  });
});
