"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
  SquareCheckBig,
} from "lucide-react";
import CombinedTestForm from "@/components/CombinedTestForm";
import { defaultCombinedTest, generateCombinedScript, combinedTestError, hasChaos } from "@/utils/combinedTest";
import styles from "./K6TestWizard.module.css";
import GuidedHTTPForm from "@/components/GuidedHTTPForm";
import { defaultGuidedTest, generateGuidedScript, validateGuidedTest, withThresholds } from "@/utils/guidedTest";
import { guidedDraftKey, parseGuidedDraft, serializeGuidedDraft } from "@/utils/guidedDraft";
import Modal from "@/components/ui/Modal";
import PreflightPanel from "@/components/guardian/PreflightPanel";
import K6ScriptEditor from "@/components/K6ScriptEditor";
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
  onCreated: (result?: { name: string; clusterId: string; namespace: string; scheduled: boolean }) => void;
}

type SchedulePreset = "daily" | "weekly" | "monthly" | "custom";
type LaunchKind = "testrun" | "job";
type TestActionId =
  | "http"
  | "auth"
  | "graphql"
  | "websocket"
  | "s3"
  | "sqs";

type ActionDefinition = {
  key: string;
  secret?: boolean;
};

type TestAction = {
  id: TestActionId;
  title: string;
  description: string;
  env: string[];
  definitions: ActionDefinition[];
  snippet: string;
};

const TEST_ACTIONS: Array<Omit<TestAction, "title" | "description">> = [
  {
    id: "http",
    env: ["TARGET_URL"],
    definitions: [{ key: "TARGET_URL" }],
    snippet: `// Action: API HTTP / REST
  const response = http.get(__ENV.TARGET_URL);
  check(response, { 'HTTP status is 2xx': (r) => r.status >= 200 && r.status < 300 });`,
  },
  {
    id: "auth",
    env: ["AUTH_URL", "API_URL", "USERNAME", "PASSWORD"],
    definitions: [
      { key: "AUTH_URL" }, { key: "API_URL" }, { key: "USERNAME" }, { key: "PASSWORD", secret: true },
    ],
    snippet: `// Action: authentification
  const login = http.post(__ENV.AUTH_URL, JSON.stringify({ username: __ENV.USERNAME, password: __ENV.PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(login, { 'login succeeded': (r) => r.status === 200 });
  const token = login.json('access_token');
  const response = http.get(__ENV.API_URL, { headers: { Authorization: \`Bearer \${token}\` } });
  check(response, { 'authenticated request succeeded': (r) => r.status === 200 });`,
  },
  {
    id: "graphql",
    env: ["GRAPHQL_URL"],
    definitions: [{ key: "GRAPHQL_URL" }],
    snippet: `// Action: GraphQL
  const response = http.post(__ENV.GRAPHQL_URL, JSON.stringify({ query: '{ __typename }' }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(response, { 'GraphQL response has no errors': (r) => r.status === 200 && !r.json('errors') });`,
  },
  {
    id: "websocket",
    env: ["WS_URL"],
    definitions: [{ key: "WS_URL" }],
    snippet: `// Action: WebSocket (add: import ws from 'k6/ws'; at the top of this script)
  // const response = ws.connect(__ENV.WS_URL, {}, (socket) => socket.close());
  // check(response, { 'WebSocket connected': (r) => r && r.status === 101 });`,
  },
  {
    id: "s3",
    env: ["S3_PRESIGNED_URL"],
    definitions: [{ key: "S3_PRESIGNED_URL" }],
    snippet: `// Action: Amazon S3 via URL présignée
  const response = http.get(__ENV.S3_PRESIGNED_URL);
  check(response, { 'S3 object downloaded': (r) => r.status === 200 });`,
  },
  {
    id: "sqs",
    env: ["SQS_PROXY_URL"],
    definitions: [{ key: "SQS_PROXY_URL" }],
    snippet: `// Action: Amazon SQS via un endpoint applicatif/proxy
  const response = http.post(__ENV.SQS_PROXY_URL, JSON.stringify({ message: 'k6 test message' }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(response, { 'SQS message accepted': (r) => r.status >= 200 && r.status < 300 });`,
  },
];

function getTestActions(copy: ReturnType<typeof getK6WorkspaceCopy>): TestAction[] {
  const content: Record<TestActionId, Pick<TestAction, "title" | "description">> = {
    http: { title: copy.actionHttpTitle, description: copy.actionHttpDescription },
    auth: { title: copy.actionAuthTitle, description: copy.actionAuthDescription },
    graphql: { title: copy.actionGraphqlTitle, description: copy.actionGraphqlDescription },
    websocket: { title: copy.actionWebsocketTitle, description: copy.actionWebsocketDescription },
    s3: { title: copy.actionS3Title, description: copy.actionS3Description },
    sqs: { title: copy.actionSqsTitle, description: copy.actionSqsDescription },
  };
  return TEST_ACTIONS.map((action) => ({ ...action, ...content[action.id] }));
}

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
  const { lang, t } = usePreferences();
  const copy = getK6WorkspaceCopy(lang);
  const testActions = useMemo(() => getTestActions(copy), [copy]);
  const [step, setStep] = useState(0);
  const [combinedMode, setCombinedMode] = useState(false);
  const [combined, setCombined] = useState({ ...defaultCombinedTest });
  const [guidedMode, setGuidedMode] = useState(false);
  const [guided, setGuided] = useState({ ...defaultGuidedTest });
  const [runSuffix, setRunSuffix] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
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

  const [datasetFiles, setDatasetFiles] = useState<string[]>([]);
  const [availableFiles, setAvailableFiles] = useState<string[]>([]);
  const [thresholds, setThresholds] = useState<{ metric: string; comparator: string; value: number }[]>([]);
  const [selectedActions, setSelectedActions] = useState<TestActionId[]>([]);
  const wizardSessionRef = useRef(0);
  const allowAutoTemplateRef = useRef(true);

  useEffect(() => {
    if (open && step > 0) {
      allowAutoTemplateRef.current = false;
    }
  }, [open, step]);

  useEffect(() => {
    const fetchAvailableFiles = async () => {
      try {
        const files = await api.listFiles();
        setAvailableFiles((files || []).map((f: any) => f.filename));
      } catch (err) {
        console.error('Failed to load files', err);
      }
    };
    fetchAvailableFiles();
  }, []);

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
      allowAutoTemplateRef.current = true;
      return;
    }

    const session = wizardSessionRef.current + 1;
    wizardSessionRef.current = session;
    allowAutoTemplateRef.current = true;

    const timer = window.setTimeout(() => {
      setStep(0);
      setGuidedMode(false); setCombinedMode(false); setCombined({ ...defaultCombinedTest });
      setGuided({ ...defaultGuidedTest });
      setDraftNotice("");
      setRunSuffix(crypto.randomUUID().slice(0, 8));
      setError("");
      setAction(initialAction);
      setTemplateId("");
      setName("");
      setScript(FALLBACK_SCRIPT);
      setParallelism(1);
      setCpu("500m");
      setMemory("512Mi");
      setImage("");
      setOutput("");
      setEnvVars([]);
      setThresholds([]);
      setSelectedActions([]);
      setDatasetFiles([]);
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
          if (wizardSessionRef.current !== session) return;
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
          if (templateData[0] && allowAutoTemplateRef.current) {
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
    allowAutoTemplateRef.current = false;
    setTemplateId(template.id);
    setName(sanitizeK8sName(template.name));
    const scriptContent = template.script_content || FALLBACK_SCRIPT;
    setGuidedMode(false); setCombinedMode(false); setSelectedActions([]);
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

  const toggleTestAction = (testAction: TestAction) => {
    const selected = selectedActions.includes(testAction.id);
    if (selected) {
      setSelectedActions((current) => current.filter((id) => id !== testAction.id));
      setScript((current) =>
        current.replace(
          new RegExp(
            `\\n?\\s*// BEGIN k6 action: ${testAction.id}[\\s\\S]*?\\s*// END k6 action: ${testAction.id}\\n?`,
          ),
          "\n",
        ),
      );
      return;
    }

    setSelectedActions((current) => [...current, testAction.id]);
    setEnvVars((current) => {
      const next = [...current];
      testAction.env.forEach((key) => {
        if (!next.some((item) => item.key === key)) next.push({ key, value: "" });
      });
      return next;
    });
    setScript((current) => {
      if (current.includes(`// BEGIN k6 action: ${testAction.id}`)) return current;
      const trimmed = current.trimEnd();
      const lastBrace = trimmed.lastIndexOf("}");
      const insertion = `\n\n  // BEGIN k6 action: ${testAction.id}\n  {\n    ${testAction.snippet.replace(/\n/g, "\n    ")}\n  }\n  // END k6 action: ${testAction.id}\n`;
      return lastBrace >= 0
        ? `${trimmed.slice(0, lastBrace)}${insertion}}${trimmed.slice(lastBrace + 1)}`
        : `${trimmed}${insertion}`;
    });
  };

  const setEnvVarValue = (key: string, value: string) => {
    setEnvVars((current) => {
      const existingIndex = current.findIndex((item) => item.key === key);
      if (existingIndex === -1) return [...current, { key, value }];
      const next = [...current];
      next[existingIndex] = { ...next[existingIndex], value };
      return next;
    });
  };

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
      if (tempStep === 2 && guidedMode && !validateGuidedTest(guided)) { setError(t("guidedInvalid")); return; }
      if (tempStep === 2 && combinedError) { setError(t(combinedError)); return; }
      if (tempStep === 2 && prepared.error) { setError(prepared.error); return; }
      if (tempStep === 2 && !guidedMode && !script.trim()) {
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
    if (step === 2 && combinedError) return t(combinedError);
    if (step === 2 && guidedMode && !validateGuidedTest(guided)) return t("guidedInvalid");
    if (step === 2 && !guidedMode && !script.trim()) return copy.required;
    if (step === 3 && parallelism < 1) return copy.required;
    if (step === 4 && action === "schedule" && !isValidCron(cron))
      return copy.invalidCron;
    return "";
  };

  const next = () => {
    const validation = validateStep() || (step === 2 ? prepared.error : "");
    if (validation) {
      setError(validation);
      return;
    }
    setError("");
    setStep((current) => Math.min(5, current + 1));
  };

  const composedChaos = combinedMode && hasChaos(combined);
  const combinedError = combinedMode ? (combinedTestError(combined) || (composedChaos && parallelism !== 1 ? "combinedSingleRunner" : "")) : "";
  const resourceName = (guidedMode || combinedMode) ? `${sanitizeK8sName(name).slice(0, 40)}-${runSuffix}` : sanitizeK8sName(name);
  const prepared = useMemo(() => {
    try {
      const source = combinedMode ? generateCombinedScript(combined, { cluster: clusterId, namespace, run: resourceName }) : guidedMode ? generateGuidedScript(guided, { cluster: clusterId, namespace, run: resourceName }) : script;
      return { script: withThresholds(source, thresholds), error: "" };
    } catch { return { script, error: t("guidedScriptInvalid") }; }
  }, [combinedMode, combined, guidedMode, guided, clusterId, namespace, resourceName, script, thresholds, t]);
  const draftKey = () => guidedDraftKey(localStorage.getItem("username") || "", localStorage.getItem("active_workspace_id") || "default");
  const saveDraft = () => {
    try {
      localStorage.setItem(draftKey(), serializeGuidedDraft({ version: 1, guided, clusterId, namespace, name, parallelism, cpu, memory }));
      setDraftNotice(t("guidedSaved"));
    } catch { setDraftNotice(t("guidedDraftError")); }
  };
  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(draftKey());
      if (!raw) { setDraftNotice(t("guidedNoDraft")); return; }
      const draft = parseGuidedDraft(raw);
      allowAutoTemplateRef.current = false;
      setGuidedMode(true); setCombinedMode(false); setTemplateId("guided-http"); setGuided(draft.guided);
      setName(draft.name); setParallelism(draft.parallelism); setCpu(draft.cpu); setMemory(draft.memory);
      setClusterId(clusters.some(c => c.id === draft.clusterId) ? draft.clusterId : "");
      setNamespace(draft.namespace); setThresholds([]); setDatasetFiles([]); setEnvVars([]); setSelectedActions([]);
      setDraftNotice(""); setStep(1);
    } catch { setDraftNotice(t("guidedDraftError")); }
  };

  const buildPayload = (validationRunId?: string, resolvedRunnerImage?: string) => {
    const resourceKind = action === "schedule" ? "cronjob" : launchKind;
    const scriptName =
      ((guidedMode || combinedMode) ? `cm-${resourceName}` : selectedTemplate?.script_name) || `${sanitizeK8sName(name)}-script`;
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
    const finalScript = prepared.script;
    const runnerEnv: Array<Record<string, unknown>> = envVars.filter(item => item.key.trim() && (!(guidedMode || combinedMode) || !["STRATOS_BEARER_TOKEN", "STRATOS_RUN_ID"].includes(item.key))).map(item => ({ name: item.key, value: item.value }));
    if (guidedMode || combinedMode) {
      runnerEnv.push(resourceKind === "testrun" ? { name: "STRATOS_RUN_ID", value: resourceName } : { name: "STRATOS_RUN_ID", valueFrom: { fieldRef: { fieldPath: "metadata.labels['job-name']" } } });
      if (guidedMode && guided.auth === "bearer") runnerEnv.push({ name: "STRATOS_BEARER_TOKEN", valueFrom: { secretKeyRef: { name: guided.secretName, key: guided.secretKey } } });
    }
    const payload: Record<string, unknown> = {
      name: resourceName,
      scriptContent: finalScript,
      resource_kind: resourceKind,
      active: action === "schedule" ? true : undefined,
      datasetFiles: datasetFiles,
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
          ...(runnerEnv.length ? { env: runnerEnv } : {}),
        },
        ...(output.trim() ? { arguments: output.trim() } : {}),
      },
      ...(action === "schedule" ? { cronExpression: cron } : {}),
      ...(validationRunId ? { validation_run_id: validationRunId } : {}),
    };
    return payload;
  };

  const submit = () => {
    const validation = (combinedError ? t(combinedError) : "") || (guidedMode && !validateGuidedTest(guided) ? t("guidedInvalid") : prepared.error) || validateStep();
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
      const created = await api.createCRD(
        clusterId,
        namespace,
        buildPayload(validationRunId, resolvedRunnerImage),
      );
      setPreflightOpen(false);
      if (guidedMode) saveDraft();
      onCreated({ name: created.metadata?.name || resourceName, clusterId, namespace, scheduled: action === "schedule" });
      onClose();
    } catch (reason) {
      setPreflightOpen(false);
      setError(reason instanceof Error ? reason.message : copy.createError);
    } finally {
      setLoading(false);
    }
  };

  const reviewRows = [
    [copy.name, resourceName],
    [copy.chooseTemplate, combinedMode ? t("combinedTitle") : guidedMode ? t("guidedTitle") : selectedTemplate?.name || "—"],
    [
      copy.target,
      `${clusters.find((cluster) => cluster.id === clusterId)?.name || clusterId} / ${namespace}`,
    ],
    ...(combinedMode ? [[copy.actionsTitle, combined.actions.join(" + ")]] : []),
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
        className={styles.wizard}
        contained
      >
        <div
          className="flex h-full min-h-0 flex-col gap-4"
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
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button type="button" onClick={restoreDraft} disabled={loading} className="text-purple-300 disabled:opacity-50">{t("guidedRestore")}</button>
            {guidedMode && <button type="button" onClick={saveDraft} className="text-purple-300">{t("guidedSave")}</button>}
            {draftNotice && <span role="status">{draftNotice}</span>}
          </div>
          {guidedMode && <p className="text-[11px] text-slate-400">{t("guidedDraftHint")}</p>}
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
                  <button type="button" aria-pressed={combinedMode} className={styles.entry} onClick={() => {
                    allowAutoTemplateRef.current = false; setCombinedMode(true); setGuidedMode(false); setTemplateId("combined"); setName("combined-test"); setParallelism(1); setLaunchKind("job"); setImage(""); setThresholds([]); setSelectedActions([]); setDatasetFiles([]); setEnvVars([]); setStep(1);
                  }}><Layers3 size={24} /><strong>{t("combinedTitle")}</strong><span>{t("combinedHint")}</span><span className="mt-3 font-mono">HTTP · pod_kill · network_latency</span></button>
                  <button type="button" aria-pressed={guidedMode} onClick={() => {
                    allowAutoTemplateRef.current = false; setGuidedMode(true); setCombinedMode(false); setTemplateId("guided-http"); setName("http-test"); setParallelism(1); setThresholds([]); setSelectedActions([]); setDatasetFiles([]); setEnvVars([]); setStep(1);
                  }} className={styles.entry}>
                    <strong className="block text-sm">{t("guidedStart")}</strong><span className="mt-2 block text-xs text-slate-400">{t("guidedHint")}</span>
                  </button>
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
                <div className="space-y-4 min-h-0">
                  {guidedMode && <GuidedHTTPForm value={guided} onChange={setGuided} />}
                  {combinedMode && <CombinedTestForm value={combined} namespace={namespace} onChange={value => { setCombined(value); if (hasChaos(value)) setParallelism(1); }} />}
                  {!guidedMode && !combinedMode && <>
                  <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/30" aria-labelledby="k6-test-actions-title">
                    <div className="mb-4 flex items-start gap-2.5">
                      <span className="mt-0.5 rounded-lg bg-purple-100 p-1.5 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300">
                        <SquareCheckBig className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div>
                        <h3 id="k6-test-actions-title" className="text-sm font-semibold text-slate-800 dark:text-slate-100">{copy.actionsTitle}</h3>
                        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{copy.actionsDescription}</p>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {testActions.map((testAction) => {
                        const checked = selectedActions.includes(testAction.id);
                        return (
                          <label key={testAction.id} className={`group flex cursor-pointer gap-2.5 rounded-xl border p-3 transition ${checked ? "border-purple-500 bg-purple-50 shadow-sm dark:border-purple-500/60 dark:bg-purple-500/10" : "border-slate-200 bg-white hover:border-purple-300 hover:bg-purple-50/50 dark:border-slate-800 dark:bg-slate-950/30 dark:hover:border-slate-700 dark:hover:bg-slate-900/60"}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTestAction(testAction)}
                              className="mt-0.5 h-4 w-4 shrink-0 accent-purple-600"
                            />
                            <span>
                              <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100">{testAction.title}</span>
                              <span className="mt-1 block text-[11px] leading-4 text-slate-600 dark:text-slate-400">{testAction.description}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {selectedActions.length > 0 && (
                      <div className="mt-4 rounded-xl border border-purple-200 bg-purple-50/70 p-3.5 dark:border-purple-500/20 dark:bg-purple-500/5" aria-labelledby="k6-action-definitions-title">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <h3 id="k6-action-definitions-title" className="text-xs font-semibold text-purple-900 dark:text-purple-200">{copy.actionsConfigTitle}</h3>
                            <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">{copy.actionsConfigDescription}</p>
                          </div>
                          <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-purple-700 shadow-sm dark:bg-purple-500/10 dark:text-purple-300">{selectedActions.length} {copy.actionsSelected}</span>
                        </div>
                        <div className="space-y-3">
                          {testActions.filter((testAction) => selectedActions.includes(testAction.id)).map((testAction) => (
                            <fieldset key={testAction.id} className="rounded-lg border border-purple-200/80 bg-white/80 px-3 pb-3 pt-2 dark:border-purple-500/15 dark:bg-slate-950/20">
                              <legend className="px-1 text-xs font-semibold text-slate-800 dark:text-slate-200">{testAction.title}</legend>
                              <div className="flex flex-wrap gap-3">
                                {testAction.definitions.map((definition) => {
                                  const inputId = `k6-action-${testAction.id}-${definition.key.toLowerCase()}`;
                                  const value = envVars.find((item) => item.key === definition.key)?.value || "";
                                  return (
                                    <label key={definition.key} htmlFor={inputId} className="min-w-48 flex-1 space-y-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                                      <span>{definition.key}</span>
                                      <input
                                        id={inputId}
                                        type={definition.secret ? "password" : "text"}
                                        value={value}
                                        placeholder={copy.actionValuePlaceholder}
                                        onChange={(event) => setEnvVarValue(definition.key, event.target.value)}
                                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-600"
                                      />
                                    </label>
                                  );
                                })}
                              </div>
                            </fieldset>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                  <K6ScriptEditor
                    script={script}
                    onChange={setScript}
                    editorKey={templateId || "new-test"}
                    label={copy.manualEditor}
                    layout="split"
                    height="360px"
                  />

                  </>}
                  {(guidedMode || combinedMode) && <pre className="max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs" aria-label={copy.script}>{prepared.script}</pre>}
                  {prepared.error && <p role="alert" className="text-red-300">{prepared.error}</p>}
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
                  {composedChaos && <p className={styles.notice}>{t("combinedSingleRunner")}</p>}
                  <div className="grid md:grid-cols-2 gap-4">
                    <label className="space-y-2 text-xs text-slate-400">
                      <span>{copy.parallelism}</span>
                      <input
                        type="number"
                        min={1}
                        value={parallelism}
                        disabled={composedChaos}
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

                    {/* Dataset Files Section */}
                    <div className="md:col-span-2 space-y-3 pt-3 border-t border-slate-800/80">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                          Dataset Variable Files (CSV / JSON)
                        </span>
                        <label className="px-3 py-1 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 rounded-xl text-[10px] font-semibold cursor-pointer transition flex items-center gap-1.5">
                          Upload File
                          <input
                            type="file"
                            accept=".csv,.json"
                            className="hidden"
                            onChange={async (e) => {
                              if (e.target.files && e.target.files[0]) {
                                const fileObj = e.target.files[0];
                                const fd = new FormData();
                                fd.append('file', fileObj);
                                try {
                                  const res = await api.uploadFile(fd);
                                  setAvailableFiles(prev => [...prev, res.filename]);
                                  setDatasetFiles(prev => [...prev, res.filename]);
                                } catch (err) {
                                  alert(err instanceof Error ? err.message : 'Upload failed');
                                }
                              }
                            }}
                          />
                        </label>
                      </div>

                      {availableFiles.length === 0 ? (
                        <p className="text-[11px] text-slate-500 italic">No files uploaded in this workspace yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {availableFiles.map(fName => {
                            const isSelected = datasetFiles.includes(fName);
                            return (
                              <button
                                type="button"
                                key={fName}
                                onClick={() => {
                                  if (isSelected) {
                                    setDatasetFiles(prev => prev.filter(f => f !== fName));
                                  } else {
                                    setDatasetFiles(prev => [...prev, fName]);
                                  }
                                }}
                                className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono transition flex items-center gap-1.5 cursor-pointer ${
                                  isSelected
                                    ? 'bg-purple-500/10 border-purple-500/40 text-purple-400'
                                    : 'bg-slate-950/40 border-slate-850 text-slate-400 hover:border-slate-800'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-purple-400' : 'bg-slate-700'}`} />
                                {fName}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* K6 Thresholds Editor Section */}
                    <div className="md:col-span-2 space-y-4 pt-4 border-t border-slate-800/80">
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                        K6 Thresholds Editor
                      </span>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-slate-950/40 p-3 rounded-2xl border border-slate-850">
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Metric</label>
                          <select
                            id="threshold-metric"
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-purple-500/50 cursor-pointer"
                          >
                            <option value="http_req_duration">http_req_duration (p95 ms)</option>
                            <option value="http_req_failed">http_req_failed (error rate)</option>
                            <option value="http_reqs">http_reqs (total reqs)</option>
                            <option value="vus">vus (VUs count)</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Comparator</label>
                          <select
                            id="threshold-comparator"
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-purple-500/50 cursor-pointer"
                          >
                            <option value="&lt;">&lt;</option>
                            <option value="&gt;">&gt;</option>
                            <option value="&lt;=">&lt;=</option>
                            <option value="&gt;=">&gt;=</option>
                            <option value="==">==</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Target Value</label>
                          <input
                            id="threshold-value"
                            type="number"
                            placeholder="e.g. 500"
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-purple-500/50"
                          />
                        </div>

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => {
                              const metricEl = document.getElementById('threshold-metric') as HTMLSelectElement;
                              const compEl = document.getElementById('threshold-comparator') as HTMLSelectElement;
                              const valEl = document.getElementById('threshold-value') as HTMLInputElement;
                              if (metricEl && compEl && valEl && valEl.value) {
                                const metric = metricEl.value;
                                const comparator = compEl.value;
                                const value = Number(valEl.value);
                                setThresholds(prev => [...prev, { metric, comparator, value }]);
                                valEl.value = '';
                              }
                            }}
                            className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold cursor-pointer transition border border-purple-500/20"
                          >
                            Add Rule
                          </button>
                        </div>
                      </div>

                      {thresholds.length > 0 && (
                        <div className="space-y-2">
                          {thresholds.map((t, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-slate-950/20 px-4 py-2 rounded-xl border border-slate-850/60">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-purple-400 font-mono uppercase bg-purple-500/5 border border-purple-500/10 px-1.5 py-0.5 rounded">
                                  {t.metric}
                                </span>
                                <span className="font-mono text-slate-300 text-xs">
                                  {t.comparator} {t.value}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setThresholds(prev => prev.filter((_, i) => i !== idx))}
                                className="text-[10px] text-red-400 hover:text-red-300 font-semibold cursor-pointer"
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
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
                      {prepared.script}
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
        subjectRef={resourceName}
        clusterId={clusterId}
        namespace={namespace}
        environment="kubernetes"
        payload={buildPayload()}
        onProceed={create}
      />
    </>
  );
}
