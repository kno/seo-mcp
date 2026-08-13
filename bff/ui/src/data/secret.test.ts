import { describe, expect, it } from "vitest";
import { SecretCell } from "./secret";

describe("SecretCell", () => {
  it("returns the wrapped value on the first take()", () => {
    const cell = SecretCell.from("super-secret-key");
    expect(cell.take()).toBe("super-secret-key");
  });

  it("returns undefined on every take() after the first (one-shot)", () => {
    const cell = SecretCell.from("super-secret-key");
    cell.take();
    expect(cell.take()).toBeUndefined();
    expect(cell.take()).toBeUndefined();
  });

  it("never exposes the raw value through toString()", () => {
    const cell = SecretCell.from("super-secret-key");
    expect(String(cell)).not.toContain("super-secret-key");
    expect(`${cell}`).not.toContain("super-secret-key");
  });

  it("never exposes the raw value through JSON.stringify()", () => {
    const cell = SecretCell.from("super-secret-key");
    expect(JSON.stringify(cell)).not.toContain("super-secret-key");
    expect(JSON.stringify({ apiKey: cell })).not.toContain("super-secret-key");
  });

  it("still redacts toString()/JSON output after the value has been taken", () => {
    const cell = SecretCell.from("super-secret-key");
    cell.take();
    expect(String(cell)).not.toContain("super-secret-key");
    expect(JSON.stringify(cell)).not.toContain("super-secret-key");
  });
});
