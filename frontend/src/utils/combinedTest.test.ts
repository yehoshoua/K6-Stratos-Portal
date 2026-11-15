import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { describe, expect, it, vi } from "vitest";
import { combinedTestError, CombinedTest, defaultCombinedTest, generateCombinedScript } from "./combinedTest";
import { withThresholds } from "./guidedTest";
const value: CombinedTest = { ...defaultCombinedTest, actions: ["http", "pod_kill", "network_latency"], url: "https://example.test/api", labelValue: "checkout" };
const context = { cluster: "c1", namespace: "qa", run: "combined-123" };
describe("combined scenarios", () => {
  it("runs independent HTTP and one-shot faults using the documented disruptor API", () => {
    const script = withThresholds(generateCombinedScript(value, context), [{ metric: "http_req_duration", comparator: "<", value: 500 }]);
    expect(() => parse(script, { ecmaVersion: "latest", sourceType: "module" })).not.toThrow();
    const http = { get: vi.fn(() => ({ status: 200 })) };
    const terminatePods = vi.fn(), injectHTTPFaults = vi.fn(), selectors: unknown[] = [];
    class PodDisruptor {
      constructor(selector: unknown) { selectors.push(selector); }
      terminatePods = terminatePods;
      injectHTTPFaults = injectHTTPFaults;
    }
    const result = runInNewContext(script.replace(/^import .*;\n/gm, "").replace(/export /g, "") + "\n({options,httpLoad,podKill,networkLatency})", {
      http, check: vi.fn(), sleep: vi.fn(), PodDisruptor, __ENV: { STRATOS_RUN_ID: "job-42" },
    });
    expect(Object.keys(result.options.scenarios)).toEqual(["http", "pod_kill", "network_latency"]);
    expect(result.options.scenarios.http).toMatchObject({ executor: "constant-vus", vus: 10, duration: "60s" });
    for (const id of ["pod_kill", "network_latency"]) expect(result.options.scenarios[id]).toMatchObject({ executor: "shared-iterations", vus: 1, iterations: 1 });
    expect(result.options.tags.test_run_id).toBe("job-42");
    result.httpLoad(); result.podKill(); result.networkLatency();
    expect(http.get).toHaveBeenCalledWith(value.url, expect.anything());
    expect(terminatePods).toHaveBeenCalledExactlyOnceWith({ count: 1 });
    expect(injectHTTPFaults).toHaveBeenCalledExactlyOnceWith({ port: 80, averageDelay: "200ms" }, "30s");
    expect(selectors).toEqual(Array(2).fill({ namespace: "qa", select: { labels: { app: "checkout" } } }));
  });
  it("omits deselected faults and imports and safely serializes input", () => {
    const script = generateCombinedScript({ ...value, actions: ["http"], url: 'https://example.test/?q=";throw new Error("bad")//' }, context);
    expect(script).not.toContain("PodDisruptor"); expect(script).not.toContain("podKill"); expect(script).not.toContain("networkLatency");
    expect(() => parse(script, { ecmaVersion: "latest", sourceType: "module" })).not.toThrow();
    expect(generateCombinedScript({ ...value, actions: ["pod_kill"] }, context)).not.toContain("k6/http");
  });
  it("validates only selected actions and requires a precise pod selector", () => {
    expect(combinedTestError(value)).toBe("");
    expect(combinedTestError({ ...value, actions: [] })).toBe("combinedSelect");
    for (const patch of [{ url: "file:///tmp/a" }, { url: "https://u:p@example.test" }, { labelValue: "" }, { labelKey: "bad/key/name" }, { vus: 0 }, { podCount: 1.5 }, { latencyDuration: -1 }, { latencyMs: NaN }, { port: 8000 }, { port: 65536 }]) {
      expect(combinedTestError({ ...value, ...patch })).toBe("combinedInvalid");
    }
    expect(combinedTestError({ ...value, labelKey: "app.kubernetes.io/name" })).toBe("");
    expect(combinedTestError({ ...defaultCombinedTest, actions: ["pod_kill"], labelValue: "checkout" })).toBe("");
    expect(combinedTestError({ ...value, actions: ["http"], labelValue: "", latencyMs: NaN })).toBe("");
  });
  it("keeps faults inside the HTTP load window", () => {
    expect(combinedTestError({ ...value, killStart: 60 })).toBe("combinedTiming");
    expect(combinedTestError({ ...value, latencyStart: 40 })).toBe("combinedTiming");
    expect(combinedTestError({ ...value, latencyStart: 30 })).toBe("");
  });
});
