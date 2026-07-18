import type { BatchWorkload, K6CRD } from "@/services/api";

export type ExecutionState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "unknown";

export interface ExecutionViewModel {
  id: string;
  name: string;
  clusterId: string;
  namespace: string;
  resourceKind: "TestRun" | "Job";
  trigger: "manual" | "scheduled" | "unknown";
  state: ExecutionState;
  createdAt: string;
  scriptName: string;
  parallelism?: number;
  raw: K6CRD | BatchWorkload;
}

export interface ScheduleViewModel {
  id: string;
  name: string;
  clusterId: string;
  namespace: string;
  cron: string;
  recurrence: string;
  active: boolean;
  nextRun?: Date;
  createdAt: string;
  scriptName: string;
  raw: BatchWorkload;
}

function normalizedState(resource: K6CRD): ExecutionState {
  const stage = String(resource.status?.stage || "").toLowerCase();
  const conditions = Array.isArray(
    resource.status && (resource.status as Record<string, unknown>).conditions,
  )
    ? ((resource.status as Record<string, unknown>).conditions as Array<
        Record<string, unknown>
      >)
    : [];
  const conditionText = conditions
    .map((condition) => `${condition.type || ""} ${condition.reason || ""}`)
    .join(" ")
    .toLowerCase();
  const value = `${stage} ${conditionText}`;
  if (/fail|error/.test(value)) return "failed";
  if (/finish|complete|success/.test(value)) return "succeeded";
  if (/run|active|started|initializ/.test(value)) return "running";
  if (/pend|created|queued/.test(value)) return "pending";
  return "unknown";
}

export function normalizeExecution(
  resource: K6CRD | BatchWorkload,
  clusterId?: string,
): ExecutionViewModel {
  const kind =
    String(resource.kind || "").toLowerCase() === "job" ? "Job" : "TestRun";
  const annotatedTrigger =
    resource.metadata &&
    (resource.metadata as unknown as { annotations?: Record<string, string> })
      .annotations?.["k6-stratos/trigger"];
  return {
    id: `${clusterId || ("cluster_id" in resource ? resource.cluster_id : "")}:${resource.metadata.namespace}:${resource.metadata.name}:${kind}`,
    name: resource.metadata.name,
    clusterId:
      clusterId || ("cluster_id" in resource ? resource.cluster_id : ""),
    namespace: resource.metadata.namespace || "default",
    resourceKind: kind,
    trigger:
      annotatedTrigger === "scheduled"
        ? "scheduled"
        : annotatedTrigger === "manual"
          ? "manual"
          : "unknown",
    state: normalizedState(resource),
    createdAt: resource.metadata.creationTimestamp,
    scriptName: resource.spec?.script?.configMap?.name || "",
    parallelism:
      typeof resource.spec?.parallelism === "number"
        ? resource.spec.parallelism
        : undefined,
    raw: resource,
  };
}

function matchesCronField(field: string, value: number): boolean {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    const step = part.match(/^\*\/(\d+)$/);
    if (step) return value % Number(step[1]) === 0;
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) return value >= Number(range[1]) && value <= Number(range[2]);
    return Number(part) === value;
  });
}

export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const ranges: Array<[number, number]> = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  return fields.every((field, index) =>
    field.split(",").every((part) => {
      if (part === "*") return true;
      const step = part.match(/^\*\/(\d+)$/);
      if (step) return Number(step[1]) > 0;
      const range = part.match(/^(\d+)-(\d+)$/);
      if (range)
        return (
          Number(range[1]) >= ranges[index][0] &&
          Number(range[2]) <= ranges[index][1] &&
          Number(range[1]) <= Number(range[2])
        );
      const value = Number(part);
      return (
        Number.isInteger(value) &&
        value >= ranges[index][0] &&
        value <= ranges[index][1]
      );
    }),
  );
}

export function nextCronOccurrences(
  expression: string,
  from = new Date(),
  count = 3,
): Date[] {
  if (!isValidCron(expression) || count <= 0) return [];
  const [minute, hour, day, month, weekday] = expression.trim().split(/\s+/);
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const results: Date[] = [];
  const maxChecks = 60 * 24 * 366 * 2;
  for (let check = 0; check < maxChecks && results.length < count; check += 1) {
    const dow = cursor.getDay();
    if (
      matchesCronField(minute, cursor.getMinutes()) &&
      matchesCronField(hour, cursor.getHours()) &&
      matchesCronField(day, cursor.getDate()) &&
      matchesCronField(month, cursor.getMonth() + 1) &&
      (matchesCronField(weekday, dow) ||
        (dow === 0 && matchesCronField(weekday, 7)))
    ) {
      results.push(new Date(cursor));
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return results;
}

export function describeCron(expression: string, locale = "fr"): string {
  if (!isValidCron(expression))
    return locale.startsWith("fr")
      ? "Expression cron invalide"
      : "Invalid cron expression";
  const [minute, hour, day, month, weekday] = expression.trim().split(/\s+/);
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  if (day === "*" && month === "*" && weekday === "*")
    return locale.startsWith("fr")
      ? `Tous les jours à ${time}`
      : `Every day at ${time}`;
  if (day === "*" && month === "*" && weekday !== "*") {
    const labels = locale.startsWith("fr")
      ? [
          "dimanche",
          "lundi",
          "mardi",
          "mercredi",
          "jeudi",
          "vendredi",
          "samedi",
        ]
      : [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ];
    const index = Number(weekday) % 7;
    return locale.startsWith("fr")
      ? `Chaque ${labels[index]} à ${time}`
      : `Every ${labels[index]} at ${time}`;
  }
  if (day !== "*" && month === "*" && weekday === "*")
    return locale.startsWith("fr")
      ? `Le ${day} de chaque mois à ${time}`
      : `On day ${day} of every month at ${time}`;
  return locale.startsWith("fr")
    ? `Cron personnalisé (${expression})`
    : `Custom cron (${expression})`;
}

export function normalizeSchedule(
  resource: BatchWorkload,
  locale = "fr",
  now = new Date(),
): ScheduleViewModel {
  const cron = resource.spec?.schedule || resource.spec?.cronExpression || "";
  return {
    id: `${resource.cluster_id}:${resource.metadata.namespace}:${resource.metadata.name}:CronJob`,
    name: resource.metadata.name,
    clusterId: resource.cluster_id,
    namespace: resource.metadata.namespace || "default",
    cron,
    recurrence: describeCron(cron, locale),
    active:
      resource.status?.active !== false && resource.status?.suspended !== true,
    nextRun: nextCronOccurrences(cron, now, 1)[0],
    createdAt: resource.metadata.creationTimestamp,
    scriptName: resource.spec?.script?.configMap?.name || "",
    raw: resource,
  };
}

function yamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number")
    return String(value);
  const text = String(value);
  return /^[a-zA-Z0-9._/@-]+$/.test(text) ? text : JSON.stringify(text);
}

export function resourceToYaml(value: unknown, level = 0): string {
  const indent = "  ".repeat(level);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object")
          return `${indent}-\n${resourceToYaml(item, level + 1)}`;
        return `${indent}- ${yamlScalar(item)}`;
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => {
        if (item && typeof item === "object")
          return `${indent}${key}:\n${resourceToYaml(item, level + 1)}`;
        return `${indent}${key}: ${yamlScalar(item)}`;
      })
      .join("\n");
  }
  return `${indent}${yamlScalar(value)}`;
}
