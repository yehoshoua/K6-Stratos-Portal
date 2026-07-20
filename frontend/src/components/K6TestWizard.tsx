"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Layers3,
  Play,
  Server,
  SlidersHorizontal,
} from "lucide-react";
import Modal from "@/components/ui/Modal";
import PreflightPanel from "@/components/guardian/PreflightPanel";
import K6StagesVisualEditor from "@/components/K6StagesVisualEditor";
import { usePreferences } from "@/components/PreferencesContext";
import { getK6WorkspaceCopy } from "@/i18n/k6Workspace";
import { api, ClusterConfig, K6Template, RunDefaults } from "@/services/api";
import { isValidCron, nextCronOccurrences } from "@/utils/k6Operations";
import {
  clusterImageContext,
  defaultRunnerImage,
  resolveClusterImage,
} from "@/utils/clusterImage";

interface K6TestWizardProps {
  open: boolean;
  advancedMode: boolean;
  initialAction?: "now" | "schedule";
  onClose: () => void;
  onCreated: () => void;
}

type SchedulePreset = "daily" | "weekly" | "monthly" | "custom";
type LaunchKind = "testrun" | "job";

export function extractEnvVarsFromScript(script: string): string[] {
  const envVars = new Set<string>();
  if (!script) return [];

  const dotRegex = /__ENV\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const bracketRegex = /__ENV\s*\[\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']\s*\]/g;

  let match;
  while ((match = dotRegex.exec(script)) !== null) {
    envVars.add(match[1]);
  }
  while ((match = bracketRegex.exec(script)) !== null) {
    envVars.add(match[1]);
  }

  return Array.from(envVars);
}

const FALLBACK_SCRIPT = `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 25 },
    { duration: '30s', target: 0 },
  ],
};

export default function () {
  const response = http.get('https://test.k6.io');
  check(response, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}`;

function sanitizeK8sName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 52) || "k6-test"
  );
}

export default function K6TestWizard({
  open,
  advancedMode,
  initialAction = "now",
  onClose,
  onCreated,
}: K6TestWizardProps) {
  const { lang } = usePreferences();
  const copy = getK6WorkspaceCopy(lang);
  const [step, setStep] = useState(0);
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [templates, setTemplates] = useState<K6Template[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<RunDefaults>({
    output_args: "",
    use_output: false,
    use_image: false,
    image_url: "",
    env_vars: [],
  });
  const [templateId, setTemplateId] = useState("");
  const [clusterId, setClusterId] = useState("");
  const [namespace, setNamespace] = useState("");
  const [name, setName] = useState("");
  const [script, setScript] = useState(FALLBACK_SCRIPT);
  const [parallelism, setParallelism] = useState(1);
  const [cpu, setCpu] = useState("500m");
  const [memory, setMemory] = useState("512Mi");
  const [image, setImage] = useState("");
  const [output, setOutput] = useState("");
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [action, setAction] = useState<"now" | "schedule">(initialAction);
  const [launchKind, setLaunchKind] = useState<LaunchKind>("testrun");
  const [preset, setPreset] = useState<SchedulePreset>("daily");
  const [hour, setHour] = useState("09");
  const [weekDay, setWeekDay] = useState("1");
  const [monthDay, setMonthDay] = useState("1");
  const [customCron, setCustomCron] = useState("0 9 * * *");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);

  const selectedTemplate = templates.find(
    (template) => template.id === templateId,
  );
  const selectedCluster = useMemo(
    () => clusters.find((cluster) => cluster.id === clusterId),
    [clusters, clusterId],
  );
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const cron = useMemo(() => {
    const normalizedHour = String(Math.max(0, Math.min(23, Number(hour) || 0)));
    if (preset === "daily") return `0 ${normalizedHour} * * *`;
    if (preset === "weekly") return `0 ${normalizedHour} * * ${weekDay}`;
    if (preset === "monthly") return `0 ${normalizedHour} ${monthDay} * *`;
    return customCron.trim();
  }, [customCron, hour, monthDay, preset, weekDay]);
  const occurrences = useMemo(
    () => nextCronOccurrences(cron, new Date(), 3),
    [cron],
  );

  const steps = [
    { label: copy.stepTemplate, icon: Layers3 },
    { label: copy.stepTarget, icon: Server },
    { label: copy.stepLoad, icon: SlidersHorizontal },
    { label: copy.stepResources, icon: Code2 },
    { label: copy.stepLaunch, icon: CalendarClock },
    { label: copy.stepReview, icon: Check },
  ];

  useEffect(() => {
    if (!open) {
      setClusterId("");
      setNamespace("");
      setNamespaces([]);
      return;
    }

    const timer = window.setTimeout(() => {
      setStep(0);
      setError("");
      setAction(initialAction);
      setClusterId("");
      setNamespace("");
      setNamespaces([]);
      setLoading(true);
      Promise.all([
        api.getClusters(),
        api.getTemplates(),
        api.getRunDefaults().catch(() => ({
          output_args: "",
          use_output: false,
          use_image: false,
          image_url: "",
          env_vars: [],
        })),
      ])
        .then(([clusterData, templateData, defaultData]) => {
          const availableClusters = clusterData || [];
          setClusters(availableClusters);
          setTemplates(templateData || []);
          setDefaults(defaultData);
          setEnvVars(defaultData.env_vars || []);
          setOutput(defaultData.use_output ? defaultData.output_args : "");
          setImage(defaultData.use_image ? defaultData.image_url : "");
          if (availableClusters[0]) {
            setClusterId(availableClusters[0].id);
          }
          if (templateData[0]) {
            applyTemplate(templateData[0], defaultData.env_vars);
          }
        })
        .catch((reason) =>
          setError(reason instanceof Error ? reason.message : copy.loadError),
        )
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [copy.loadError, initialAction, open]);

  useEffect(() => {
    if (!open || clusters.length === 0) return;
    setClusterId((current) =>
      clusters.some((cluster) => cluster.id === current)
        ? current
        : clusters[0].id,
    );
  }, [clusters, open]);

  useEffect(() => {
    if (!clusterId || !open) return;
    api
      .getNamespaces(clusterId)
      .then((items) => {
        const next = items || [];
        setNamespaces(next);
        setNamespace((current) =>
          next.includes(current) ? current : next[0] || "",
        );
      })
      .catch(() => {
        setNamespaces([]);
        setNamespace("");
      });
  }, [clusterId, open]);

  useEffect(() => {
    if (parallelism > 1) {
      setLaunchKind("testrun");
    } else {
      setLaunchKind("job");
    }
  }, [parallelism]);

  useEffect(() => {
    if (!script) return;
    const scriptEnvKeys = extractEnvVarsFromScript(script);
    setEnvVars((prev) => {
      let changed = false;
      const next = [...prev];
      scriptEnvKeys.forEach((key) => {
        if (!next.some((ev) => ev.key === key)) {
          next.push({ key, value: "" });
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [script]);

  function applyTemplate(template: K6Template, defaultEnvVars?: { key: string; value: string }[]) {
    setTemplateId(template.id);
    setName((current) => current || sanitizeK8sName(template.name));
    const scriptContent = template.script_content || FALLBACK_SCRIPT;
    setScript(scriptContent);
    setParallelism(template.parallelism || 1);
    setCpu(template.cpu_limit || "500m");
    setMemory(template.mem_limit || "512Mi");
    setImage(template.runner_image || "");

    const baseEnvs = defaultEnvVars || defaults.env_vars || [];
    const scriptEnvKeys = extractEnvVarsFromScript(scriptContent);
    const merged = [...baseEnvs];
    scriptEnvKeys.forEach(key => {
      if (!merged.some(ev => ev.key === key)) {
        merged.push({ key, value: "" });
      }
    });
    setEnvVars(merged);
  }

  const handleStepClick = (targetStep: number) => {
    if (targetStep === step) return;
    setError("");

    if (targetStep < step) {
      setStep(targetStep);
      return;
    }

    let tempStep = step;
    while (tempStep < targetStep) {
      if (tempStep === 0 && !templateId) {
        setError(copy.required);
        return;
      }
      if (tempStep === 1 && (!clusterId || !namespace || !name.trim())) {
        setError(copy.required);
        return;
      }
      if (tempStep === 2 && !script.trim()) {
        setError(copy.required);
        return;
      }
      if (tempStep === 3 && parallelism < 1) {
        setError(copy.required);
        return;
      }
      tempStep++;
    }
    setStep(targetStep);
  };

  const validateStep = () => {
    if (step === 0 && !templateId) return copy.required;
    if (step === 1 && (!clusterId || !namespace || !name.trim()))
      return copy.required;
    if (step === 2 && !script.trim()) return copy.required;
    if (step === 3 && parallelism < 1) return copy.required;
    if (step === 4 && action === "schedule" && !isValidCron(cron))
      return copy.invalidCron;
    return "";
  };

  const next = () => {
    const validation = validateStep();
    if (validation) {
      setError(validation);
      return;
    }
    setError("");
    setStep((current) => Math.min(5, current + 1));
  };

  const buildPayload = (validationRunId?: string, resolvedRunnerImage?: string) => {
    const resourceKind = action === "schedule" ? "cronjob" : launchKind;
    const scriptName =
      selectedTemplate?.script_name || `${sanitizeK8sName(name)}-script`;
    const rawRunnerImage =
      image.trim() ||
      (defaults.use_image ? defaults.image_url : "") ||
      selectedTemplate?.runner_image ||
      "";
    const runnerImage =
      resolvedRunnerImage ||
      (rawRunnerImage
        ? resolveClusterImage(rawRunnerImage, clusterImageContext(selectedCluster))
        : defaultRunnerImage(selectedCluster));
    const payload: Record<string, unknown> = {
      name: sanitizeK8sName(name),
      scriptContent: script,
      resource_kind: resourceKind,
      active: action === "schedule" ? true : undefined,
      spec: {
        parallelism,
        script: {
          configMap: {
            name: scriptName,
            file: selectedTemplate?.script_file || "script.js",
          },
        },
        runner: {
          resources: { limits: { cpu, memory } },
          ...(runnerImage ? { image: runnerImage } : {}),
          ...(envVars.filter((item) => item.key.trim()).length
            ? {
                env: envVars
                  .filter((item) => item.key.trim())
                  .map((item) => ({ name: item.key, value: item.value })),
              }
            : {}),
        },
        ...(output.trim() ? { arguments: output.trim() } : {}),
      },
      ...(action === "schedule" ? { cronExpression: cron } : {}),
      ...(validationRunId ? { validation_run_id: validationRunId } : {}),
    };
    return payload;
  };

  const submit = () => {
    const validation = validateStep();
    if (validation) {
      setError(validation);
      return;
    }
    setPreflightOpen(true);
  };

  const create = async (validationRunId: string) => {
    setLoading(true);
    setError("");
    try {
      const rawRunnerImage =
        image.trim() ||
        (defaults.use_image ? defaults.image_url : "") ||
        selectedTemplate?.runner_image ||
        "";
      let resolvedRunnerImage = rawRunnerImage
        ? resolveClusterImage(rawRunnerImage, clusterImageContext(selectedCluster))
        : defaultRunnerImage(selectedCluster);
      if (clusterId) {
        try {
          resolvedRunnerImage = await api.resolveClusterImage(
            clusterId,
            rawRunnerImage || resolvedRunnerImage,
          );
        } catch {
          // Fall back to client-side resolution above.
        }
      }
      await api.createCRD(
        clusterId,
        namespace,
        buildPayload(validationRunId, resolvedRunnerImage),
      );
      setPreflightOpen(false);
      onCreated();
      onClose();
    } catch (reason) {
      setPreflightOpen(false);
      setError(reason instanceof Error ? reason.message : copy.createError);
    } finally {
      setLoading(false);
    }
  };

  const reviewRows = [
    [copy.name, sanitizeK8sName(name)],
    [copy.chooseTemplate, selectedTemplate?.name || "—"],
    [
      copy.target,
      `${clusters.find((cluster) => cluster.id === clusterId)?.name || clusterId} / ${namespace}`,
    ],
    [copy.parallelism, String(parallelism)],
    [copy.type, launchKind === "job" ? "Job" : "TestRun"],
    [
      copy.executionType,
      action === "schedule"
        ? copy.plan
        : launchKind === "job"
          ? "Job"
          : "TestRun",
    ],
    ...(action === "schedule"
      ? [
          [copy.cron, cron],
          [copy.timezone, timezone],
        ]
      : []),
  ];

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={copy.newTest}
        subtitle={`${step + 1} / ${steps.length} · ${steps[step].label}`}
        maxWidthClassName="max-w-5xl"
        contained
      >
        <div
          className="flex h-full min-h-0 flex-col gap-6"
          dir={lang === "he" ? "rtl" : "ltr"}
        >
          <ol
            className="grid shrink-0 grid-cols-3 md:grid-cols-6 gap-2"
            aria-label={copy.newTest}
          >
            {steps.map((item, index) => {
              const Icon = item.icon;
              const selected = index === step;
              const complete = index < step;
              return (
                <li
                  key={item.label}
                  className={`rounded-xl border transition-all duration-300 ${
                    selected
                      ? "border-purple-500/50 bg-purple-500/10 text-purple-200"
                      : complete
                        ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-400 hover:border-emerald-500/40 hover:bg-emerald-500/10"
                        : "border-slate-800 text-slate-500 hover:border-slate-700 hover:bg-slate-800/20"
                  }`}
                  aria-current={selected ? "step" : undefined}
                >
                  <button
                    type="button"
                    onClick={() => handleStepClick(index)}
                    className="w-full h-full px-2 py-2 text-center focus:outline-none cursor-pointer"
                  >
                    <Icon className="w-4 h-4 mx-auto mb-1" aria-hidden="true" />
                    <span className="text-[10px] font-medium">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          {error && (
            <div
              role="alert"
              className="shrink-0 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-300"
            >
              {error}
            </div>
          )}
          {loading && step === 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto py-16 text-center text-sm text-slate-400">
              {copy.loading}
            </div>
          ) : (
            <div
              className={`min-h-0 flex-1 pr-2 ${step === 1 ? "overflow-visible" : "overflow-y-auto"}`}
            >
              {step === 0 && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => applyTemplate(template)}
                      className={`text-left rounded-2xl border p-4 transition ${templateId === template.id ? "border-purple-500/60 bg-purple-500/10" : "border-slate-800 bg-slate-950/30 hover:border-slate-700"}`}
                      aria-pressed={templateId === template.id}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-100">
                          {template.name}
                        </span>
                        <span className="text-[9px] uppercase text-slate-500">
                          {template.template_type}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-400">
                        {template.parallelism} × runner · {template.cpu_limit} ·{" "}
                        {template.mem_limit}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {step === 1 && (
                <div className="relative z-20 grid md:grid-cols-2 gap-5 max-w-3xl overflow-visible">
                  <label className="space-y-2 text-xs text-slate-400" htmlFor="k6-wizard-cluster">
                    <span>{copy.cluster}</span>
                    <select
                      id="k6-wizard-cluster"
                      value={clusterId}
                      onChange={(event) => setClusterId(event.target.value)}
                      disabled={clusters.length === 0}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-slate-200 disabled:opacity-50"
                    >
                      {clusters.length === 0 ? (
                        <option value="">{copy.required}</option>
                      ) : (
                        clusters.map((cluster) => (
                          <option key={cluster.id} value={cluster.id}>
                            {cluster.name}
                            {cluster.k6_operator_installed === false
                              ? " (k6 operator missing)"
                              : ""}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  <label className="space-y-2 text-xs text-slate-400" htmlFor="k6-wizard-namespace">
                    <span>{copy.namespace}</span>
                    <select
                      id="k6-wizard-namespace"
                      value={namespace}
                      onChange={(event) => setNamespace(event.target.value)}
                      disabled={!clusterId || namespaces.length === 0}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-slate-200 disabled:opacity-50"
                    >
                      {!clusterId || namespaces.length === 0 ? (
                        <option value="">
                          {!clusterId ? copy.cluster : copy.namespace}
                        </option>
                      ) : (
                        namespaces.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  <label className="space-y-2 text-xs text-slate-400 md:col-span-2">
                    <span>{copy.name}</span>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-slate-200"
                    />
                  </label>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  {script.includes("stages") && (
                    <K6StagesVisualEditor
                      script={script}
                      onChange={setScript}
                    />
                  )}
                  <label className="block space-y-2 text-xs text-slate-400">
                    <span>{copy.manualEditor}</span>
                    <textarea
                      value={script}
                      onChange={(event) => setScript(event.target.value)}
                      rows={13}
                      spellCheck={false}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-200"
                    />
                  </label>

                  {/* Environment Variables */}
                  <div className="space-y-3 pt-4 border-t border-slate-800/80">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        {copy.runDefaultsEnv}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEnvVars((prev) => [...prev, { key: "", value: "" }])}
                        className="text-[11px] font-semibold text-purple-400 hover:text-purple-300 transition cursor-pointer"
                      >
                        + {copy.runDefaultsEnvAdd}
                      </button>
                    </div>
                    {envVars.length === 0 ? (
                      <p className="text-[11px] text-slate-500 italic">No environment variables defined.</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {envVars.map((item, idx) => (
                          <div key={idx} className="flex gap-2 items-center">
                            <input
                              placeholder="Key"
                              value={item.key}
                              onChange={(e) => {
                                const next = [...envVars];
                                next[idx] = { ...next[idx], key: e.target.value };
                                setEnvVars(next);
                              }}
                              className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                            />
                            <input
                              placeholder="Value"
                              value={item.value}
                              onChange={(e) => {
                                const next = [...envVars];
                                next[idx] = { ...next[idx], value: e.target.value };
                                setEnvVars(next);
                              }}
                              className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setEnvVars(envVars.filter((_, i) => i !== idx));
                              }}
                              className="p-2 text-slate-500 hover:text-red-400 transition cursor-pointer"
                              title="Delete"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-5 max-w-3xl">
                  {!advancedMode && (
                    <p className="rounded-xl border border-slate-800 bg-slate-950/30 p-4 text-xs text-slate-400">
                      {copy.advancedHelp}
                    </p>
                  )}
                  <div className="grid md:grid-cols-2 gap-4">
                    <label className="space-y-2 text-xs text-slate-400">
                      <span>{copy.parallelism}</span>
                      <input
                        type="number"
                        min={1}
                        value={parallelism}
                        onChange={(event) =>
                          setParallelism(Math.max(1, Number(event.target.value)))
                        }
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-slate-200"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-400">
                      <span>{copy.image}</span>
                      <input
                        value={image}
                        onChange={(event) => setImage(event.target.value)}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 font-mono text-slate-200"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-400">
                      <span>{copy.cpu}</span>
                      <input
                        value={cpu}
                        onChange={(event) => setCpu(event.target.value)}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-slate-200"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-400">
                      <span>{copy.memory}</span>
                      <input
                        value={memory}
                        onChange={(event) => setMemory(event.target.value)}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-slate-200"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-400 md:col-span-2">
                      <span>{copy.output}</span>
                      <input
                        value={output}
                        onChange={(event) => setOutput(event.target.value)}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 font-mono text-slate-200"
                      />
                    </label>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-6 max-w-3xl">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setAction("now")}
                      aria-pressed={action === "now"}
                      className={`rounded-2xl border p-4 text-left ${action === "now" ? "border-purple-500/60 bg-purple-500/10" : "border-slate-800"}`}
                    >
                      <Play className="mb-2 h-5 w-5 text-purple-400" />
                      <span className="text-sm font-semibold">
                        {copy.launchNow}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAction("schedule")}
                      aria-pressed={action === "schedule"}
                      className={`rounded-2xl border p-4 text-left ${action === "schedule" ? "border-purple-500/60 bg-purple-500/10" : "border-slate-800"}`}
                    >
                      <CalendarClock className="mb-2 h-5 w-5 text-purple-400" />
                      <span className="text-sm font-semibold">{copy.plan}</span>
                    </button>
                  </div>
                  {action === "now" ? (
                    advancedMode && (
                      <label className="block max-w-xs space-y-2 text-xs text-slate-400">
                        <span>{copy.executionType}</span>
                        <select
                          value={launchKind}
                          onChange={(event) =>
                            setLaunchKind(event.target.value as LaunchKind)
                          }
                          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-slate-200"
                        >
                          <option value="testrun">TestRun</option>
                          <option value="job">Job</option>
                        </select>
                      </label>
                    )
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            "daily",
                            "weekly",
                            "monthly",
                            "custom",
                          ] as SchedulePreset[]
                        ).map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => setPreset(item)}
                            className={`rounded-xl border px-3 py-2 text-xs ${preset === item ? "border-purple-500/60 bg-purple-500/10 text-purple-200" : "border-slate-800 text-slate-400"}`}
                          >
                            {copy[item === "custom" ? "customCron" : item]}
                          </button>
                        ))}
                      </div>
                      {preset !== "custom" && (
                        <div className="flex flex-wrap gap-4">
                          <label className="space-y-2 text-xs text-slate-400">
                            <span>Heure</span>
                            <input
                              type="number"
                              min={0}
                              max={23}
                              value={hour}
                              onChange={(event) => setHour(event.target.value)}
                              className="block w-24 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200"
                            />
                          </label>
                          {preset === "weekly" && (
                            <label className="space-y-2 text-xs text-slate-400">
                              <span>Jour (0–6)</span>
                              <input
                                type="number"
                                min={0}
                                max={6}
                                value={weekDay}
                                onChange={(event) =>
                                  setWeekDay(event.target.value)
                                }
                                className="block w-24 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200"
                              />
                            </label>
                          )}
                          {preset === "monthly" && (
                            <label className="space-y-2 text-xs text-slate-400">
                              <span>Jour (1–31)</span>
                              <input
                                type="number"
                                min={1}
                                max={31}
                                value={monthDay}
                                onChange={(event) =>
                                  setMonthDay(event.target.value)
                                }
                                className="block w-24 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200"
                              />
                            </label>
                          )}
                        </div>
                      )}
                      <label className="block space-y-2 text-xs text-slate-400">
                        <span>{copy.cron}</span>
                        <input
                          value={preset === "custom" ? customCron : cron}
                          onChange={(event) => {
                            setPreset("custom");
                            setCustomCron(event.target.value);
                          }}
                          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 font-mono text-slate-200"
                        />
                      </label>
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                        <p className="text-xs font-semibold text-slate-300">
                          {copy.upcoming}
                        </p>
                        <p className="mt-1 text-[10px] text-slate-500">
                          {copy.timezone}: {timezone}
                        </p>
                        <ul className="mt-3 space-y-1 text-xs text-slate-400">
                          {occurrences.map((date) => (
                            <li key={date.toISOString()}>
                              {date.toLocaleString(lang)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step === 5 && (
                <div className="grid lg:grid-cols-2 gap-6">
                  <dl className="divide-y divide-slate-800 rounded-2xl border border-slate-800 px-4">
                    {reviewRows.map(([label, value]) => (
                      <div
                        key={label}
                        className="flex justify-between gap-4 py-3 text-xs"
                      >
                        <dt className="text-slate-500">{label}</dt>
                        <dd className="text-right font-medium text-slate-200">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                    <p className="mb-2 text-xs font-semibold text-slate-300">
                      {copy.script}
                    </p>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-[10px] leading-4 text-slate-500">
                      {script}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-800 bg-slate-900 pt-4">
            <button
              type="button"
              onClick={
                step === 0
                  ? onClose
                  : () => {
                      setError("");
                      setStep((current) => current - 1);
                    }
              }
              className="inline-flex items-center gap-2 rounded-xl border border-slate-800 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800"
            >
              <ChevronLeft className="h-4 w-4" />
              {step === 0 ? copy.cancel : copy.back}
            </button>
            {step < 5 ? (
              <button
                type="button"
                onClick={next}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 px-5 py-2 text-xs font-semibold text-white"
              >
                {copy.continue}
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 px-5 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {copy.confirm}
              </button>
            )}
          </div>
        </div>
      </Modal>
      <PreflightPanel
        open={preflightOpen}
        onClose={() => setPreflightOpen(false)}
        subjectType={action === "schedule" ? "schedule_create" : "test_launch"}
        subjectRef={sanitizeK8sName(name)}
        clusterId={clusterId}
        namespace={namespace}
        environment="kubernetes"
        payload={buildPayload()}
        onProceed={create}
      />
    </>
  );
}
