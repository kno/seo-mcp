import { LIMITS } from "../config";
import { normalizePublicUrl, resolvePublicUrl } from "../security/url-policy";

export interface BoundedResponse {
  url: URL;
  status: number;
  contentType: string;
  headers: Headers;
  bytes: Uint8Array;
  // Wall-clock milliseconds covering the full retrieval: redirects + body read.
  elapsedMs: number;
}

export interface FetchBudget {
  fetcher: typeof fetch;
  used(): number;
}

export interface ResponseByteBudget {
  consume(bytes: number): void;
  remaining(): number;
  used(): number;
}

export function createResponseByteBudget(maximum: number): ResponseByteBudget {
  let count = 0;
  return {
    consume: (bytes) => {
      if (bytes < 0 || count + bytes > maximum) {
        throw new Error(
          `Crawl response byte budget of ${maximum} was exhausted`,
        );
      }
      count += bytes;
    },
    remaining: () => maximum - count,
    used: () => count,
  };
}

export function createFetchBudget(
  fetcher: typeof fetch = fetch,
  maximum = 48,
): FetchBudget {
  let count = 0;
  return {
    fetcher: async (input, init) => {
      if (count >= maximum)
        throw new Error(`Crawl subrequest budget of ${maximum} was exhausted`);
      count++;
      return fetcher(input, init);
    },
    used: () => count,
  };
}

async function readBounded(
  response: Response,
  maxBytes: number,
  byteBudget?: ResponseByteBudget,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const rawLength = response.headers.get("content-length");
  const declared = Number(rawLength);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body.cancel();
    throw new Error(`Response exceeds ${maxBytes} byte limit`);
  }
  if (
    rawLength !== null &&
    Number.isFinite(declared) &&
    declared > (byteBudget?.remaining() ?? Infinity)
  ) {
    await response.body.cancel();
    throw new Error("Crawl response byte budget was exhausted");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds ${maxBytes} byte limit`);
      }
      try {
        byteBudget?.consume(value.byteLength);
      } catch (error) {
        await reader.cancel();
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function fetchBounded(
  input: string | URL,
  options: {
    maxBytes: number;
    accept: string;
    timeoutMs?: number;
    fetcher?: typeof fetch;
    byteBudget?: ResponseByteBudget;
    now?: () => number;
  },
): Promise<BoundedResponse> {
  let url = normalizePublicUrl(input.toString());
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("Fetch timed out"),
    options.timeoutMs ?? LIMITS.fetchTimeoutMs,
  );

  const start = now();
  try {
    for (let redirects = 0; redirects <= LIMITS.maxRedirects; redirects++) {
      const response = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: options.accept,
          "user-agent": "seo-mcp/0.1 (+https://github.com/kno/seo-mcp)",
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location)
          throw new Error("Redirect response is missing a Location header");
        if (redirects === LIMITS.maxRedirects)
          throw new Error("Too many redirects");
        url = resolvePublicUrl(location, url);
        continue;
      }

      const bytes = await readBounded(
        response,
        options.maxBytes,
        options.byteBudget,
      );
      return {
        url,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        headers: response.headers,
        bytes,
        elapsedMs: now() - start,
      };
    }
    throw new Error("Too many redirects");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Fetch timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
