export const MAX_MCP_REQUEST_BYTES = 64_000;

export type BoundedMcpRequest =
  | { request: Request; response?: never }
  | { request?: never; response: Response };

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function boundMcpRequest(
  request: Request,
  maximum = MAX_MCP_REQUEST_BYTES,
): Promise<BoundedMcpRequest> {
  if (request.method !== "POST") return { request };

  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    await request.body?.cancel();
    return {
      response: errorResponse("Content-Type must be application/json", 415),
    };
  }

  const rawLength = request.headers.get("content-length");
  if (rawLength !== null) {
    if (!/^\d+$/.test(rawLength)) {
      await request.body?.cancel();
      return { response: errorResponse("Invalid Content-Length", 400) };
    }
    if (Number(rawLength) > maximum) {
      await request.body?.cancel();
      return {
        response: errorResponse(`Request exceeds ${maximum} byte limit`, 413),
      };
    }
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maximum) {
          await reader.cancel();
          return {
            response: errorResponse(
              `Request exceeds ${maximum} byte limit`,
              413,
            ),
          };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { response: errorResponse("Unable to read request body", 400) };
  } finally {
    reader?.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    JSON.parse(new TextDecoder().decode(body));
  } catch {
    return {
      response: errorResponse("Request body must contain valid JSON", 400),
    };
  }

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return {
    request: new Request(request.url, {
      method: request.method,
      headers,
      body: body.buffer,
    }),
  };
}
