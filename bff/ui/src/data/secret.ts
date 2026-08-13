/**
 * One-shot secret cell for `analyze_pagespeed`'s optional `apiKey` input —
 * the only view in this dashboard that handles a real user-supplied
 * credential (`pagespeed-view`'s "PageSpeed API Key Is Never Persisted or
 * Echoed" requirement). Mirrors the type-level discipline `data/client.ts`
 * already established for no-polling with the branded `UserIntent`: instead
 * of relying on a review convention ("never call `setState` with the raw
 * key"), the raw string is made structurally hard to reach more than once.
 *
 * `PageSpeedForm` reads the raw value once, at submit time, directly from
 * the uncontrolled `<input>` element (never through `useState`, so it can
 * never appear in a React DevTools state snapshot or a component re-render)
 * and immediately wraps it with `SecretCell.from()`. The cell is handed
 * straight to `requestTool`'s `secrets` option; nothing else in this
 * codebase calls `.take()`. `take()` returns the value exactly once —
 * every subsequent call returns `undefined` — so a caller that accidentally
 * holds onto the same cell (e.g. in a later render, an export step, or a
 * memoized cache) cannot recover the raw value from it a second time.
 * `toString()`/`toJSON()` never expose the raw value either, so an
 * accidental `console.log(cell)` or `JSON.stringify({ ...formInput })`
 * cannot leak it even before `take()` is ever called.
 */
export class SecretCell {
  #value: string | undefined;

  private constructor(value: string) {
    this.#value = value;
  }

  static from(value: string): SecretCell {
    return new SecretCell(value);
  }

  /**
   * Returns the wrapped value exactly once. After the first call (whether
   * it returned a value or the cell was never populated), every subsequent
   * call returns `undefined`.
   */
  take(): string | undefined {
    const value = this.#value;
    this.#value = undefined;
    return value;
  }

  toString(): string {
    return "[SecretCell: redacted]";
  }

  toJSON(): string {
    return "[SecretCell: redacted]";
  }
}
