import { describe, expect, it } from "vitest";
import type { BatchWorkload, K6CRD } from "@/services/api";
import {
  describeCron,
  isValidCron,
  nextCronOccurrences,
  normalizeExecution,
  normalizeSchedule,
  resourceToYaml,
} from "./k6Operations";

const testRun: K6CRD = {
  apiVersion: "k6.io/v1alpha1",
  kind: "TestRun",
  metadata: {
    name: "checkout-load",
    namespace: "qa",
    creationTimestamp: "2026-07-17T08:00:00Z",
  },
  spec: {
    parallelism: 3,
    script: { configMap: { name: "checkout-script", file: "script.js" } },
  },
  status: { stage: "finished" },
};

const cronJob: BatchWorkload = {
  apiVersion: "batch/v1",
  kind: "CronJob",
  cluster_id: "cluster-a",
  metadata: {
    name: "nightly-checkout",
    namespace: "qa",
    creationTimestamp: "2026-07-17T08:00:00Z",
  },
  spec: {
    schedule: "0 9 * * 1",
    script: { configMap: { name: "checkout-script" } },
  },
  status: { stage: "", active: true },
};

describe("K6 operation normalization", () => {
  it("normalizes a TestRun without inventing a trigger relation", () => {
    const result = normalizeExecution(testRun, "cluster-a");
    expect(result).toMatchObject({
      name: "checkout-load",
      clusterId: "cluster-a",
      namespace: "qa",
      resourceKind: "TestRun",
      state: "succeeded",
      trigger: "unknown",
      parallelism: 3,
    });
  });

  it("normalizes a CronJob with recurrence and next run", () => {
    const result = normalizeSchedule(
      cronJob,
      "fr",
      new Date("2026-07-19T08:00:00"),
    );
    expect(result.recurrence).toBe("Chaque lundi à 09:00");
    expect(result.active).toBe(true);
    expect(result.nextRun?.getDay()).toBe(1);
    expect(result.nextRun?.getHours()).toBe(9);
  });
});

describe("cron generation and preview", () => {
  it("validates supported five-field expressions", () => {
    expect(isValidCron("0 9 * * *")).toBe(true);
    expect(isValidCron("*/15 * * * *")).toBe(true);
    expect(isValidCron("0 25 * * *")).toBe(false);
    expect(isValidCron("0 9 * *")).toBe(false);
  });

  it("calculates the next three occurrences", () => {
    const occurrences = nextCronOccurrences(
      "0 9 * * *",
      new Date("2026-07-17T08:30:00"),
      3,
    );
    expect(occurrences).toHaveLength(3);
    expect(occurrences.map((date) => date.getHours())).toEqual([9, 9, 9]);
    expect(occurrences[1].getTime() - occurrences[0].getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  it("describes standard presets in natural language", () => {
    expect(describeCron("0 9 * * *", "fr")).toBe("Tous les jours à 09:00");
    expect(describeCron("0 9 15 * *", "fr")).toBe(
      "Le 15 de chaque mois à 09:00",
    );
  });

  it("renders the advanced Kubernetes configuration as YAML", () => {
    expect(resourceToYaml({ kind: "TestRun", spec: { parallelism: 2 } })).toBe(
      "kind: TestRun\nspec:\n  parallelism: 2",
    );
  });
});
