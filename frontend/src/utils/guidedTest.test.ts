import { describe, expect, it } from "vitest";
import { parse } from "acorn";
import { defaultGuidedTest, generateGuidedScript, validateGuidedTest, withThresholds } from "./guidedTest";
import { guidedDraftKey, parseGuidedDraft, serializeGuidedDraft } from "./guidedDraft";

describe("guided scripts", () => {
  it("escapes URL and body data, uses valid aggregates and exact telemetry tags", () => {
    const input = { ...defaultGuidedTest, url: "https://example.test/path?x='", method: "POST" as const, body: "'}; throw new Error('injection'); //", auth: "bearer" as const, secretName: "api-auth" };
    expect(validateGuidedTest(input)).toBe(true);
    const script = generateGuidedScript(input, { cluster: "c1", namespace: "qa", run: "test-123" });
    expect(() => parse(script, { ecmaVersion: "latest", sourceType: "module" })).not.toThrow();
    expect(script).toContain('p(95)<500');
    expect(script).toContain('rate<=0.01');
    expect(script).toContain('"cluster": "c1"');
    expect(script).toContain('__ENV.STRATOS_BEARER_TOKEN');
  });
  it("rejects invalid targets, authentication references and loads", () => {
    for (const override of [{url:"file:///tmp/x"}, {url:"https://user:password@example.test"}, {vus:0}, {vus:1.5}, {durationSeconds:3601}, {maxErrorPercent:101}, {auth:"bearer",secretName:""}]) {
      expect(validateGuidedTest({...defaultGuidedTest,url:"https://example.test",...override} as typeof defaultGuidedTest)).toBe(false);
    }
  });
  it("merges thresholds without duplicate options exports or breaking nested objects", () => {
    const source = `export const options = { scenarios: { main: { executor: 'constant-vus', vus: 2, duration: '1m' } }, thresholds: { checks: ['rate>0.9'] } };\nexport default function () {}`;
    const script = withThresholds(source,[{metric:"http_req_duration",comparator:"<",value:300}]);
    expect(() => parse(script,{ecmaVersion:"latest",sourceType:"module"})).not.toThrow();
    expect(script.match(/export const options/g)).toHaveLength(1);
    expect(script).toContain('"http_req_duration":["p(95)<300"]');
    expect(script).toContain("...options.thresholds");
  });
  it("supports aliased options and rejects ambiguous imported options", () => {
    const threshold = [{metric:"http_req_failed",comparator:"<=",value:0.01}];
    expect(withThresholds('const config={}; export { config as options };',threshold)).toContain('config.thresholds =');
    expect(() => withThresholds('export { options } from "./shared.js";',threshold)).toThrow();
    expect(() => withThresholds('export const options = {',[])).toThrow();
  });
});
describe("guided drafts", () => {
  it("omits bodies, URL credentials and query strings, and scopes keys per user/workspace", () => {
    const draft = { version:1 as const, guided:{...defaultGuidedTest,url:"https://user:password@example.test/api?token=secret#fragment",body:"sensitive"},clusterId:"c",namespace:"qa",name:"test",parallelism:1,cpu:"500m",memory:"512Mi" };
    const saved=serializeGuidedDraft(draft);
    for(const secret of ["password","sensitive","token=secret","fragment"]) expect(saved).not.toContain(secret);
    expect(parseGuidedDraft(saved).guided.url).toBe("https://example.test/api");
    expect(guidedDraftKey("alice","a")).not.toBe(guidedDraftKey("bob","a"));
    expect(guidedDraftKey("alice","a")).not.toBe(guidedDraftKey("alice","b"));
    expect(()=>parseGuidedDraft('{"version":1}')).toThrow();
  });
});
