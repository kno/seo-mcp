export function logRequestMetrics(m: {
  path: string;
  status: number;
  durationMs: number;
}): void {
  console.log(JSON.stringify({ kind: "request_metrics", ...m }));
}
