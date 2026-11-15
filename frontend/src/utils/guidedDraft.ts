import { defaultGuidedTest, type GuidedTest } from "./guidedTest";
export interface GuidedDraft {
  version: 1; guided: GuidedTest; clusterId: string; namespace: string; name: string;
  parallelism: number; cpu: string; memory: string;
}
export function guidedDraftKey(username: string, workspace: string): string {
  return `stratos.guided.v1:${encodeURIComponent(username)}:${encodeURIComponent(workspace)}`;
}
// Never persist request bodies, query strings, credentials or arbitrary script/env values.
export function serializeGuidedDraft(draft: GuidedDraft): string {
  let safeURL = "";
  try { const u = new URL(draft.guided.url); u.username = ""; u.password = ""; u.search = ""; u.hash = ""; safeURL = u.toString(); } catch { /* partial drafts may have no URL */ }
  const guided = Object.fromEntries(Object.keys(defaultGuidedTest).map(k => [k, draft.guided[k as keyof GuidedTest]])) as unknown as GuidedTest;
  return JSON.stringify({ version: 1, guided: { ...guided, url: safeURL, body: "" }, clusterId: draft.clusterId, namespace: draft.namespace, name: draft.name, parallelism: draft.parallelism, cpu: draft.cpu, memory: draft.memory });
}
export function parseGuidedDraft(raw: string): GuidedDraft {
  if (raw.length > 20000) throw new Error("invalid draft");
  const d = JSON.parse(raw) as GuidedDraft;
  if (d?.version !== 1 || !d.guided || !Number.isInteger(d.parallelism) || d.parallelism < 1 || d.parallelism > 10000) throw new Error("invalid draft");
  for (const key of ["clusterId", "namespace", "name", "cpu", "memory"] as const) if (typeof d[key] !== "string" || d[key].length > 256) throw new Error("invalid draft");
  for (const key of Object.keys(defaultGuidedTest) as (keyof GuidedTest)[]) {
    if (typeof d.guided[key] !== typeof defaultGuidedTest[key] || (typeof d.guided[key] === "number" && !Number.isFinite(d.guided[key]))) throw new Error("invalid draft");
  }
  return JSON.parse(serializeGuidedDraft(d)) as GuidedDraft;
}
