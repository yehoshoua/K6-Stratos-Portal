export type CombinedAction = "http" | "pod_kill" | "network_latency";
export interface CombinedTest {
  actions: CombinedAction[];
  url: string;
  vus: number;
  duration: number;
  labelKey: string;
  labelValue: string;
  podCount: number;
  killStart: number;
  latencyStart: number;
  latencyDuration: number;
  latencyMs: number;
  port: number;
}
export const defaultCombinedTest: CombinedTest = {
  actions: ["http"], url: "", vus: 10, duration: 60,
  labelKey: "app", labelValue: "", podCount: 1, killStart: 20,
  latencyStart: 10, latencyDuration: 30, latencyMs: 200, port: 80,
};
export const hasChaos = (value: CombinedTest) => value.actions.some(a => a !== "http");
const integer = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
const labelPart = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/;
function validLabelKey(key: string) {
  const parts = key.split("/");
  const name = parts.pop()!;
  return parts.length <= 1 && name.length <= 63 && labelPart.test(name) && (!parts.length ||
    (parts[0].length <= 253 && parts[0].split(".").every(p => p.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(p))));
}
export function combinedTestError(value: CombinedTest): "combinedSelect" | "combinedInvalid" | "combinedTiming" | "" {
  if (!value.actions.length) return "combinedSelect";
  if (value.actions.includes("http")) {
    try {
      const url = new URL(value.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "combinedInvalid";
    } catch { return "combinedInvalid"; }
    if (!integer(value.vus, 1, 10000) || !integer(value.duration, 1, 86400)) return "combinedInvalid";
  }
  if (hasChaos(value) && (!validLabelKey(value.labelKey) || !labelPart.test(value.labelValue) || value.labelValue.length > 63)) return "combinedInvalid";
  if (value.actions.includes("pod_kill") && (!integer(value.podCount, 1, 1000) || !integer(value.killStart, 0, 86400))) return "combinedInvalid";
  if (value.actions.includes("network_latency") && (!integer(value.latencyStart, 0, 86400) || !integer(value.latencyDuration, 1, 86400) || !integer(value.latencyMs, 1, 60000) || !integer(value.port, 1, 65535) || value.port === 8000)) return "combinedInvalid";
  if (value.actions.includes("http") && (
    (value.actions.includes("pod_kill") && value.killStart >= value.duration) ||
    (value.actions.includes("network_latency") && value.latencyStart + value.latencyDuration > value.duration)
  )) return "combinedTiming";
  return "";
}

// Each fault gets one dedicated VU and one iteration; HTTP continues independently.
// PodDisruptor API: https://grafana.com/docs/k6/latest/testing-guides/injecting-faults-with-xk6-disruptor/xk6-disruptor/poddisruptor/
export function generateCombinedScript(value: CombinedTest, context: { cluster: string; namespace: string; run: string }): string {
  const imports: string[] = [];
  const functions: string[] = [];
  const scenarios: Record<string, unknown> = {};
  const selector = JSON.stringify({ namespace: context.namespace, select: { labels: { [value.labelKey]: value.labelValue } } });
  if (value.actions.includes("http")) {
    imports.push("import http from 'k6/http';", "import { check, sleep } from 'k6';");
    scenarios.http = { executor: "constant-vus", exec: "httpLoad", vus: value.vus, duration: `${value.duration}s`, gracefulStop: "5s" };
    functions.push(`export function httpLoad() {
  const response = http.get(${JSON.stringify(value.url)}, { tags: { name: 'combined-http' } });
  check(response, { 'HTTP status is 2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(1);
}`);
  }
  if (hasChaos(value)) imports.push("import { PodDisruptor } from 'k6/x/disruptor';");
  if (value.actions.includes("pod_kill")) {
    scenarios.pod_kill = { executor: "shared-iterations", exec: "podKill", vus: 1, iterations: 1, startTime: `${value.killStart}s`, maxDuration: "60s", gracefulStop: "5s" };
    functions.push(`export function podKill() {
  const disruptor = new PodDisruptor(${selector});
  disruptor.terminatePods({ count: ${value.podCount} });
}`);
  }
  if (value.actions.includes("network_latency")) {
    scenarios.network_latency = { executor: "shared-iterations", exec: "networkLatency", vus: 1, iterations: 1, startTime: `${value.latencyStart}s`, maxDuration: `${value.latencyDuration + 60}s`, gracefulStop: "5s" };
    functions.push(`export function networkLatency() {
  const disruptor = new PodDisruptor(${selector});
  disruptor.injectHTTPFaults({ port: ${value.port}, averageDelay: '${value.latencyMs}ms' }, '${value.latencyDuration}s');
}`);
  }
  const options = { scenarios, tags: { cluster: context.cluster, namespace: context.namespace, test_run_id: context.run } };
  return `${imports.join("\n")}\n\nexport const options = ${JSON.stringify(options, null, 2)};\noptions.tags.test_run_id = __ENV.STRATOS_RUN_ID || options.tags.test_run_id;\n\n${functions.join("\n\n")}\n`;
}
