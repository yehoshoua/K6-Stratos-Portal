import { parse } from "acorn";

export interface GuidedTest {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body: string;
  vus: number;
  durationSeconds: number;
  p95Ms: number;
  maxErrorPercent: number;
  auth: "none" | "bearer";
  secretName: string;
  secretKey: string;
}
export const defaultGuidedTest: GuidedTest = {
  url: "", method: "GET", body: "", vus: 10, durationSeconds: 60,
  p95Ms: 500, maxErrorPercent: 1, auth: "none", secretName: "", secretKey: "token",
};
export interface Threshold { metric: string; comparator: string; value: number }
export function validateGuidedTest(input: GuidedTest): boolean {
  try {
    const url = new URL(input.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) return false;
  } catch { return false; }
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(input.method) || !["none", "bearer"].includes(input.auth)) return false;
  if (!Number.isInteger(input.vus) || input.vus < 1 || input.vus > 10000 || !Number.isInteger(input.durationSeconds) || input.durationSeconds < 1 || input.durationSeconds > 3600) return false;
  if (!Number.isFinite(input.p95Ms) || input.p95Ms <= 0 || !Number.isFinite(input.maxErrorPercent) || input.maxErrorPercent < 0 || input.maxErrorPercent > 100 || input.body.length > 65536) return false;
  if (input.auth === "bearer" && (!/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(input.secretName) || !/^[A-Za-z0-9_.-]{1,253}$/.test(input.secretKey))) return false;
  return true;
}
export function generateGuidedScript(input: GuidedTest, target: { cluster: string; namespace: string; run: string }): string {
  // JSON serialization keeps URLs and request bodies as data, never JavaScript.
  const options = {
    vus: input.vus, duration: `${input.durationSeconds}s`,
    thresholds: { http_req_duration: [`p(95)<${input.p95Ms}`], http_req_failed: [`rate<=${input.maxErrorPercent / 100}`] },
    tags: { cluster: target.cluster, namespace: target.namespace, test_run_id: target.run },
  };
  return `import http from 'k6/http';\nimport { check, sleep } from 'k6';\n\nexport const options = ${JSON.stringify(options, null, 2)};\noptions.tags.test_run_id = __ENV.STRATOS_RUN_ID || options.tags.test_run_id;\n\nexport default function () {\n  const headers = { 'Content-Type': 'application/json' };\n${input.auth === "bearer" ? "  if (!__ENV.STRATOS_BEARER_TOKEN) throw new Error('Missing STRATOS_BEARER_TOKEN');\n  headers.Authorization = 'Bearer ' + __ENV.STRATOS_BEARER_TOKEN;\n" : ""}  const response = http.request(${JSON.stringify(input.method)}, ${JSON.stringify(input.url)}, ${input.method === "GET" ? "null" : JSON.stringify(input.body)}, { headers });\n  check(response, { 'HTTP status is 2xx': (r) => r.status >= 200 && r.status < 300 });\n  sleep(1);\n}\n`;
}
export function withThresholds(script: string, thresholds: Threshold[]): string {
  const ast = parse(script, { ecmaVersion: "latest", sourceType: "module" });
  if (!thresholds.length) return script;
  const aggregates: Record<string, string> = { http_req_duration: "p(95)", http_req_failed: "rate", checks: "rate", http_reqs: "count", vus: "value" };
  const result: Record<string, string[]> = {};
  for (const item of thresholds) {
    if (!aggregates[item.metric] || !["<", "<=", ">", ">=", "==", "!="].includes(item.comparator) || !Number.isFinite(item.value)) throw new Error("invalid_threshold");
    (result[item.metric] ||= []).push(`${aggregates[item.metric]}${item.comparator}${item.value}`);
  }
  let optionsName: string | undefined;
  for (const node of ast.body) {
    if (node.type !== "ExportNamedDeclaration") continue;
    if (node.declaration?.type === "VariableDeclaration") {
      for (const d of node.declaration.declarations) if (d.id.type === "Identifier" && d.id.name === "options") optionsName = "options";
    }
    for (const specifier of node.specifiers) {
      const exported = specifier.exported.type === "Identifier" ? specifier.exported.name : specifier.exported.value;
      if (exported === "options") { if (node.source || specifier.local.type !== "Identifier") throw new Error("imported_options"); optionsName = specifier.local.name; }
    }
  }
  const serialized = JSON.stringify(result);
  const output = optionsName
    ? `${script}\n\n${optionsName}.thresholds = { ...${optionsName}.thresholds, ...${serialized} };\n`
    : `${script}\n\nexport const options = { thresholds: ${serialized} };\n`;
  parse(output, { ecmaVersion: "latest", sourceType: "module" });
  return output;
}
