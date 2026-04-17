/**
 * Simple in-process Prometheus-compatible metrics.
 *
 * Tracks:
 *  - http_requests_total{method, status_code, path}
 *  - http_request_duration_ms (histogram via buckets)
 *  - ai_requests_total{model}
 *  - ai_tokens_total{model, type}  (type = prompt | completion)
 *  - errors_total{type}
 *  - process_uptime_seconds
 *
 * Exported as Prometheus text format via GET /metrics.
 * No external dependency — pure in-process counters reset on restart.
 * For production scale, replace with prom-client or ship to Prometheus push gateway.
 */

interface Counter {
  [label: string]: number;
}

const counters: Record<string, Counter> = {
  http_requests_total: {},
  ai_requests_total: {},
  ai_prompt_tokens_total: {},
  ai_completion_tokens_total: {},
  errors_total: {},
};

// Simple histogram buckets for request latency (ms)
const LATENCY_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000, Infinity];
const latencyBuckets: Record<number, number> = {};
let latencySum = 0;
let latencyCount = 0;

for (const b of LATENCY_BUCKETS) {
  latencyBuckets[b] = 0;
}

function inc(metric: string, label: string, value = 1): void {
  const c = counters[metric];
  if (!c) return;
  c[label] = (c[label] ?? 0) + value;
}

export function recordHttpRequest(method: string, statusCode: number, path: string, durationMs: number): void {
  const simplified = path.replace(/\/\d+/g, "/:id").replace(/[?#].*$/, "");
  inc("http_requests_total", `method="${method}",status="${statusCode}",path="${simplified}"`);

  latencySum += durationMs;
  latencyCount++;
  for (const b of LATENCY_BUCKETS) {
    if (durationMs <= b) {
      latencyBuckets[b]++;
    }
  }
}

export function recordAiRequest(model: string, promptTokens: number, completionTokens: number): void {
  inc("ai_requests_total", `model="${model}"`);
  inc("ai_prompt_tokens_total", `model="${model}"`, promptTokens);
  inc("ai_completion_tokens_total", `model="${model}"`, completionTokens);
}

export function recordError(type: string): void {
  inc("errors_total", `type="${type}"`);
}

function renderCounter(name: string, help: string, labels: Counter): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
  for (const [label, value] of Object.entries(labels)) {
    lines.push(`${name}{${label}} ${value}`);
  }
  return lines.join("\n");
}

export function renderMetrics(): string {
  const uptime = process.uptime();
  const memMb = process.memoryUsage().heapUsed / 1024 / 1024;

  const parts: string[] = [];

  parts.push(renderCounter("http_requests_total", "Total HTTP requests", counters.http_requests_total));
  parts.push(renderCounter("ai_requests_total", "Total AI model requests", counters.ai_requests_total));
  parts.push(renderCounter("ai_prompt_tokens_total", "Total prompt tokens consumed", counters.ai_prompt_tokens_total));
  parts.push(renderCounter("ai_completion_tokens_total", "Total completion tokens generated", counters.ai_completion_tokens_total));
  parts.push(renderCounter("errors_total", "Total errors", counters.errors_total));

  // Latency histogram
  const histLines = [
    "# HELP http_request_duration_ms HTTP request latency in milliseconds",
    "# TYPE http_request_duration_ms histogram",
  ];
  let cumulative = 0;
  for (const b of LATENCY_BUCKETS) {
    cumulative += latencyBuckets[b];
    const le = b === Infinity ? "+Inf" : String(b);
    histLines.push(`http_request_duration_ms_bucket{le="${le}"} ${cumulative}`);
  }
  histLines.push(`http_request_duration_ms_sum ${latencySum.toFixed(2)}`);
  histLines.push(`http_request_duration_ms_count ${latencyCount}`);
  parts.push(histLines.join("\n"));

  // Process stats
  parts.push([
    "# HELP process_uptime_seconds Process uptime in seconds",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${uptime.toFixed(2)}`,
  ].join("\n"));

  parts.push([
    "# HELP process_heap_used_mb Heap memory used in MB",
    "# TYPE process_heap_used_mb gauge",
    `process_heap_used_mb ${memMb.toFixed(2)}`,
  ].join("\n"));

  return parts.join("\n\n") + "\n";
}
