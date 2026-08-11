function normalizedAuthority(url: URL): string {
  return url.host.toLowerCase().replace(/\.+(?=:|$)/, "");
}

function reject(request: Request, message: string): Response {
  void request.body?.cancel();
  return Response.json({ error: message }, { status: 403 });
}

export function validateMcpRequest(request: Request): Response | undefined {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (
    host &&
    host.toLowerCase().replace(/\.+(?=:|$)/, "") !== normalizedAuthority(url)
  ) {
    return reject(request, "Host header does not match the request URL");
  }

  const originValue = request.headers.get("origin");
  if (!originValue) return;
  let origin: URL;
  try {
    origin = new URL(originValue);
  } catch {
    return reject(request, "Invalid Origin header");
  }
  if (origin.origin !== url.origin) {
    return reject(request, "Cross-origin MCP requests are not allowed");
  }
}
