/**
 * `site-crawl-view`'s "Long-Running Crawl Shows Progress or an Honest
 * Indeterminate State" seam. `design.md`'s sequence diagram describes this
 * as a `readToolResponse(response)` function dispatching on the raw HTTP
 * response's `content-type` header, so a future SSE resolution can yield
 * real `Progress` frames without changing the view. `requestTool()`
 * (`data/client.ts`) already fully consumes the `Response` (it awaits
 * `.json()` internally and returns the parsed envelope) rather than
 * exposing it, so this module wraps the *promise* `requestTool` returns
 * instead of the raw `Response` object — the shape callers see
 * (`{ progress, result }`, decoupled from each other) is preserved, which
 * is the property the container and the progress-display component
 * actually depend on. Today's real BFF surface for `crawl_site`
 * (`bff/src/router.ts`) answers with exactly one bounded `Response.json(...)`
 * and no `text/event-stream` branch, so this implementation yields exactly
 * one `"indeterminate"` frame and resolves `result` to the same envelope.
 * Swapping in a real SSE resolution later means replacing this function's
 * body with one that reads a `ReadableStream` and yields real `Progress`
 * frames as they parse — `ToolResponseStream`'s shape does not change, and
 * therefore neither does any caller.
 */

export interface Progress {
  readonly crawled: number;
  readonly requested: number;
}

export interface ToolResponseStream<T> {
  readonly progress: AsyncIterable<Progress | "indeterminate">;
  readonly result: Promise<T>;
}

export function readToolResponse<T>(
  resultPromise: Promise<T>,
): ToolResponseStream<T> {
  async function* indeterminateProgress(): AsyncGenerator<
    Progress | "indeterminate"
  > {
    yield "indeterminate";
  }

  return {
    progress: indeterminateProgress(),
    result: resultPromise,
  };
}
