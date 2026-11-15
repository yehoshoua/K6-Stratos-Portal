"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  Braces,
  CalendarClock,
  CirclePause,
  CirclePlay,
  Code2,
  FileText,
  Gauge,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import K6TestWizard from "@/components/K6TestWizard";
import Modal from "@/components/ui/Modal";
import { usePreferences } from "@/components/PreferencesContext";
import { getK6WorkspaceCopy } from "@/i18n/k6Workspace";
import { api, BatchWorkload, ClusterConfig, K6Template } from "@/services/api";
import {
  describeCron,
  ExecutionViewModel,
  normalizeExecution,
  normalizeSchedule,
  resourceToYaml,
  ScheduleViewModel,
} from "@/utils/k6Operations";

type WorkspaceTab = "executions" | "schedules" | "scripts";
type DrawerTab = "summary" | "metrics" | "logs" | "configuration";
type ConfigMapItem = {
  name: string;
  namespace?: string;
  data: Record<string, string>;
};
type ActionMenuState =
  | {
      kind: "execution";
      item: ExecutionViewModel;
      top: number;
      left: number;
    }
  | {
      kind: "schedule";
      item: ScheduleViewModel;
      top: number;
      left: number;
    };
type DeleteTarget = {
  clusterId: string;
  name: string;
  namespace: string;
  resourceKind?: ExecutionViewModel["resourceKind"];
  action?: "delete" | "stop";
};

const statusStyles: Record<ExecutionViewModel["state"], string> = {
  running: "border-purple-500/25 bg-purple-500/10 text-purple-300",
  succeeded: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  failed: "border-red-500/25 bg-red-500/10 text-red-300",
  pending: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  unknown: "border-slate-700 bg-slate-800/60 text-slate-400",
};

function dateLabel(value: string | Date | undefined, locale: string) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

export default function TestsWorkspacePage() {
  const router = useRouter();
  const { lang, t } = usePreferences();
  const copy = getK6WorkspaceCopy(lang);
  const [tab, setTab] = useState<WorkspaceTab>("executions");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [role, setRole] = useState("viewer");
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [templates, setTemplates] = useState<K6Template[]>([]);
  const [executions, setExecutions] = useState<ExecutionViewModel[]>([]);
  const [schedules, setSchedules] = useState<ScheduleViewModel[]>([]);
  const [configMaps, setConfigMaps] = useState<ConfigMapItem[]>([]);
  const [scriptCluster, setScriptCluster] = useState("");
  const [scriptNamespace, setScriptNamespace] = useState("");
  const [scriptNamespaces, setScriptNamespaces] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [clusterFilter, setClusterFilter] = useState("");
  const [namespaceFilter, setNamespaceFilter] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resultsHref, setResultsHref] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardAction, setWizardAction] = useState<"now" | "schedule">("now");
  const [selectedExecution, setSelectedExecution] =
    useState<ExecutionViewModel | null>(null);
  const [selectedSchedule, setSelectedSchedule] =
    useState<ScheduleViewModel | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("summary");
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [editSchedule, setEditSchedule] = useState<ScheduleViewModel | null>(
    null,
  );
  const [editCron, setEditCron] = useState("");
  const [actionMenu, setActionMenu] = useState<ActionMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canEdit = role === "editor" || role === "administrator";
  const activeDrawer = selectedExecution || selectedSchedule;

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [clusterData, templateData] = await Promise.all([
        api.getClusters(),
        api.getTemplates(),
      ]);
      const availableClusters = clusterData || [];
      setClusters(availableClusters);
      setTemplates(templateData || []);
      setScriptCluster((current) => current || availableClusters[0]?.id || "");
      const executionItems: ExecutionViewModel[] = [];
      const scheduleItems: ScheduleViewModel[] = [];
      let failures = 0;
      await Promise.all(
        availableClusters.map(async (cluster) => {
          const [crdResult, batchResult] = await Promise.allSettled([
            api.getCRDs(cluster.id, "all"),
            api.getBatchWorkloads(cluster.id, "all"),
          ]);
          if (crdResult.status === "fulfilled") {
            for (const item of crdResult.value || []) {
              const kind = String(item.kind || "").toLowerCase();
              if (kind === "k6" || kind === "testrun")
                executionItems.push(normalizeExecution(item, cluster.id));
            }
          } else failures += 1;
          if (batchResult.status === "fulfilled") {
            for (const raw of batchResult.value || []) {
              const item: BatchWorkload = { ...raw, cluster_id: cluster.id };
              const kind = String(item.kind || "").toLowerCase();
              if (kind === "job") executionItems.push(normalizeExecution(item));
              if (kind === "cronjob")
                scheduleItems.push(normalizeSchedule(item, lang));
            }
          } else failures += 1;
        }),
      );
      executionItems.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      scheduleItems.sort((a, b) => a.name.localeCompare(b.name));
      setExecutions(executionItems);
      setSchedules(scheduleItems);
      if (failures === availableClusters.length * 2 && availableClusters.length)
        setError(copy.loadError);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [copy.loadError, lang]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requestedTab = new URLSearchParams(window.location.search).get(
        "tab",
      );
      if (
        requestedTab === "schedules" ||
        requestedTab === "scripts" ||
        requestedTab === "executions"
      )
        setTab(requestedTab);
      setAdvancedMode(localStorage.getItem("k6-advanced-mode") === "true");
      setRole(localStorage.getItem("role") || "viewer");
      loadAll();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAll]);

  useEffect(() => {
    if (!scriptCluster) return;
    api
      .getNamespaces(scriptCluster)
      .then((items) => {
        const next = items || [];
        setScriptNamespaces(next);
        setScriptNamespace((current) =>
          next.includes(current) ? current : next[0] || "",
        );
      })
      .catch(() => {
        setScriptNamespaces([]);
        setScriptNamespace("");
      });
  }, [scriptCluster]);

  const loadConfigMaps = useCallback(async () => {
    if (!scriptCluster || !scriptNamespace) {
      setConfigMaps([]);
      return;
    }
    try {
      setConfigMaps(await api.listConfigMaps(scriptCluster, scriptNamespace));
    } catch {
      setConfigMaps([]);
    }
  }, [scriptCluster, scriptNamespace]);

  useEffect(() => {
    const timer = window.setTimeout(loadConfigMaps, 0);
    return () => window.clearTimeout(timer);
  }, [loadConfigMaps]);

  const setActiveTab = (next: WorkspaceTab) => {
    setTab(next);
    setQuery("");
    router.replace(`/tests?tab=${next}`, { scroll: false });
  };

  const toggleAdvanced = () => {
    setAdvancedMode((current) => {
      const next = !current;
      localStorage.setItem("k6-advanced-mode", String(next));
      return next;
    });
  };

  const clusterName = useCallback(
    (id: string) => clusters.find((cluster) => cluster.id === id)?.name || id,
    [clusters],
  );
  const templateName = (scriptName: string) =>
    templates.find((template) => template.script_name === scriptName)?.name ||
    scriptName ||
    "—";
  const namespaces = useMemo(
    () =>
      Array.from(
        new Set([
          ...executions.map((item) => item.namespace),
          ...schedules.map((item) => item.namespace),
        ]),
      ).sort(),
    [executions, schedules],
  );

  const filteredExecutions = useMemo(
    () =>
      executions.filter((item) => {
        const search = query.trim().toLowerCase();
        return (
          (!search ||
            `${item.name} ${item.scriptName} ${clusterName(item.clusterId)} ${item.namespace}`
              .toLowerCase()
              .includes(search)) &&
          (!stateFilter || item.state === stateFilter) &&
          (!clusterFilter || item.clusterId === clusterFilter) &&
          (!namespaceFilter || item.namespace === namespaceFilter) &&
          (!templateFilter || item.scriptName === templateFilter) &&
          (!triggerFilter || item.trigger === triggerFilter)
        );
      }),
    [
      clusterFilter,
      executions,
      namespaceFilter,
      query,
      stateFilter,
      templateFilter,
      triggerFilter,
      clusterName,
    ],
  );

  const filteredSchedules = useMemo(
    () =>
      schedules.filter((item) => {
        const search = query.trim().toLowerCase();
        return (
          (!search ||
            `${item.name} ${item.scriptName} ${item.recurrence} ${clusterName(item.clusterId)} ${item.namespace}`
              .toLowerCase()
              .includes(search)) &&
          (!clusterFilter || item.clusterId === clusterFilter) &&
          (!namespaceFilter || item.namespace === namespaceFilter) &&
          (!templateFilter || item.scriptName === templateFilter) &&
          (!stateFilter ||
            (stateFilter === "active" ? item.active : !item.active))
        );
      }),
    [
      clusterFilter,
      namespaceFilter,
      query,
      schedules,
      stateFilter,
      templateFilter,
      clusterName,
    ],
  );

  const openExecution = (
    item: ExecutionViewModel,
    nextTab: DrawerTab = "summary",
  ) => {
    setSelectedSchedule(null);
    setSelectedExecution(item);
    setDrawerTab(nextTab);
    setLogs("");
    setLogsLoading(nextTab === "logs");
  };

  const openSchedule = (item: ScheduleViewModel) => {
    setSelectedExecution(null);
    setSelectedSchedule(item);
    setDrawerTab("summary");
  };

  useEffect(() => {
    if (!selectedExecution || drawerTab !== "logs") return;
    api
      .listPods(selectedExecution.clusterId, selectedExecution.namespace)
      .then((pods) => {
        const matching = pods.filter((pod) =>
          pod.name.startsWith(selectedExecution.name),
        );
        const pod =
          matching.find(
            (item) =>
              item.name.includes("-runner") && item.status === "Running",
          ) || matching[0];
        if (!pod) return copy.noLogs;
        return api.getPodLogs(
          selectedExecution.clusterId,
          pod.name,
          selectedExecution.namespace,
        );
      })
      .then((text) => setLogs(text || copy.noLogs))
      .catch((reason) =>
        setLogs(reason instanceof Error ? reason.message : copy.noLogs),
      )
      .finally(() => setLogsLoading(false));
  }, [copy.noLogs, drawerTab, selectedExecution]);

  const relaunch = async (item: ExecutionViewModel) => {
    if (!canEdit) return;
    try {
      if (item.resourceKind === "Job") {
        await api.createCRD(item.clusterId, item.namespace, {
          name: `${item.name}-retry-${Date.now()}`.slice(0, 52),
          resource_kind: "job",
          scriptContent: "",
          spec: item.raw.spec,
        });
      } else {
        await api.relaunchCRD(item.clusterId, item.name, item.namespace);
      }
      setNotice(copy.createdSuccess);
      await loadAll();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.createError);
    }
  };

  const runScheduleNow = async (item: ScheduleViewModel) => {
    if (!canEdit) return;
    try {
      await api.createCRD(item.clusterId, item.namespace, {
        name: `${item.name}-run-${Date.now()}`.slice(0, 52),
        resource_kind: "job",
        scriptContent: "",
        spec: item.raw.spec,
      });
      setNotice(copy.createdSuccess);
      await loadAll();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.createError);
    }
  };

  const toggleSchedule = async (item: ScheduleViewModel) => {
    if (!canEdit) return;
    try {
      await api.toggleBatchCronJob(item.clusterId, item.name, item.namespace);
      await loadAll();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.createError);
    }
  };

  const requestDelete = (target: DeleteTarget) => {
    if (!canEdit) return;
    setActionMenu(null);
    setDeleteTarget({ ...target, action: "delete" });
  };

  const requestStop = (target: DeleteTarget) => {
    if (!canEdit) return;
    setActionMenu(null);
    setDeleteTarget({ ...target, action: "stop" });
  };

  const removeResource = async () => {
    if (!canEdit || !deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteCRD(
        deleteTarget.clusterId,
        deleteTarget.name,
        deleteTarget.namespace,
        deleteTarget.resourceKind,
      );
      setSelectedExecution(null);
      setSelectedSchedule(null);
      setDeleteTarget(null);
      if (deleteTarget.action === "stop") setNotice(copy.stoppedSuccess);
      await loadAll();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.createError);
    } finally {
      setDeleting(false);
    }
  };

  const openActionMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    menu:
      | { kind: "execution"; item: ExecutionViewModel }
      | { kind: "schedule"; item: ScheduleViewModel },
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 176;
    const height = menu.kind === "schedule" ? 184 : 104;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - width - 8, rect.right - width),
    );
    const preferredTop = rect.bottom + 6;
    const top =
      preferredTop + height <= window.innerHeight - 8
        ? preferredTop
        : Math.max(8, rect.top - height - 6);
    setActionMenu({ ...menu, top, left });
  };

  const saveSchedule = async () => {
    if (!editSchedule || editCron.trim().split(/\s+/).length !== 5) return;
    try {
      await api.createCRD(editSchedule.clusterId, editSchedule.namespace, {
        name: editSchedule.name,
        resource_kind: "cronjob",
        active: editSchedule.active,
        cronExpression: editCron.trim(),
        scriptContent: "",
        spec: editSchedule.raw.spec,
      });
      setEditSchedule(null);
      await loadAll();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.createError);
    }
  };

  const openWizard = (action: "now" | "schedule") => {
    setWizardAction(action);
    setWizardOpen(true);
  };

  const tableFilters = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
        <span className="sr-only">{copy.search}</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.search}
          className="w-full rounded-xl border border-slate-800 bg-slate-950/70 py-2 pl-9 pr-3 text-xs text-slate-200 outline-none focus:border-purple-500/50"
        />
      </label>
      <select
        value={stateFilter}
        onChange={(event) => setStateFilter(event.target.value)}
        className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300"
      >
        <option value="">{copy.allStates}</option>
        {tab === "executions" ? (
          <>
            <option value="running">Running</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </>
        ) : (
          <>
            <option value="active">{copy.active}</option>
            <option value="inactive">{copy.inactive}</option>
          </>
        )}
      </select>
      <select
        value={clusterFilter}
        onChange={(event) => setClusterFilter(event.target.value)}
        className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300"
      >
        <option value="">{copy.allClusters}</option>
        {clusters.map((cluster) => (
          <option key={cluster.id} value={cluster.id}>
            {cluster.name}
          </option>
        ))}
      </select>
      <select
        value={namespaceFilter}
        onChange={(event) => setNamespaceFilter(event.target.value)}
        className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300"
      >
        <option value="">{copy.allNamespaces}</option>
        {namespaces.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <select
        value={templateFilter}
        onChange={(event) => setTemplateFilter(event.target.value)}
        className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300"
      >
        <option value="">Templates</option>
        {templates.map((item) => (
          <option key={item.id} value={item.script_name}>
            {item.name}
          </option>
        ))}
      </select>
      {tab === "executions" && (
        <select
          value={triggerFilter}
          onChange={(event) => setTriggerFilter(event.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300"
        >
          <option value="">{copy.allTriggers}</option>
          <option value="manual">{copy.manual}</option>
          <option value="scheduled">{copy.scheduled}</option>
          <option value="unknown">{copy.unknown}</option>
        </select>
      )}
    </div>
  );

  return (
    <div
      className="space-y-6 animate-fadeIn"
      dir={lang === "he" ? "rtl" : "ltr"}
    >
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 p-2.5">
              <Activity className="h-6 w-6 text-purple-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">
                {copy.title}
              </h1>
              <p className="mt-1 text-sm text-slate-400">{copy.subtitle}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleAdvanced}
            className="ui-mode-toggle inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold"
            aria-pressed={advancedMode}
          >
            <Braces className="h-4 w-4" />
            {advancedMode ? copy.advanced : copy.simple}
          </button>
          <button
            type="button"
            onClick={loadAll}
            className="rounded-xl border border-slate-800 p-2 text-slate-400 hover:text-white"
            aria-label={copy.refresh}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() =>
                openWizard(tab === "schedules" ? "schedule" : "now")
              }
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-purple-500/10"
            >
              <Plus className="h-4 w-4" />
              {copy.newTest}
            </button>
          )}
        </div>
      </header>

      {!canEdit && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3 text-xs text-slate-400">
          {copy.viewerHint}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-300"
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">
          {notice}
          {resultsHref && <Link href={resultsHref} className="ms-3 underline">{t("guidedResults")}</Link>}
        </div>
      )}

      <nav
        className="flex overflow-x-auto border-b border-slate-800"
        aria-label={copy.title}
      >
        {(
          [
            ["executions", copy.executions, Activity],
            ["schedules", copy.schedules, CalendarClock],
            ["scripts", copy.scripts, Code2],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`inline-flex min-w-max items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${tab === id ? "border-purple-500 text-purple-300" : "border-transparent text-slate-500 hover:text-slate-300"}`}
            aria-current={tab === id ? "page" : undefined}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      {tab !== "scripts" && tableFilters}

      {tab === "executions" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/20">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">{copy.test}</th>
                <th className="px-4 py-3">{copy.target}</th>
                <th className="px-4 py-3">{copy.status}</th>
                <th className="px-4 py-3">Template</th>
                <th className="px-4 py-3">{copy.trigger}</th>
                <th className="px-4 py-3">{copy.created}</th>
                {advancedMode && <th className="px-4 py-3">Kind</th>}
                <th className="px-4 py-3 text-right">{copy.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {loading && !executions.length ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-14 text-center text-slate-500"
                  >
                    {copy.loading}
                  </td>
                </tr>
              ) : filteredExecutions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center">
                    <p className="text-slate-500">{copy.noExecutions}</p>
                    {canEdit && (
                      <button
                        onClick={() => openWizard("now")}
                        className="mt-3 text-xs font-semibold text-purple-400 hover:text-purple-300"
                      >
                        {copy.newTest}
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredExecutions.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/20">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openExecution(item)}
                        className="font-semibold text-slate-100 hover:text-purple-300"
                      >
                        {item.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      <div>{clusterName(item.clusterId)}</div>
                      <div className="text-[10px] text-slate-600">
                        {item.namespace}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusStyles[item.state]}`}
                      >
                        {item.state}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {templateName(item.scriptName)}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {item.trigger === "manual"
                        ? copy.manual
                        : item.trigger === "scheduled"
                          ? copy.scheduled
                          : copy.unknown}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {dateLabel(item.createdAt, lang)}
                    </td>
                    {advancedMode && (
                      <td className="px-4 py-3 font-mono text-slate-500">
                        {item.resourceKind}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {canEdit && (item.state === "running" || item.state === "pending") && (
                          <button
                            type="button"
                            onClick={() =>
                              requestStop({
                                clusterId: item.clusterId,
                                name: item.name,
                                namespace: item.namespace,
                                resourceKind: item.resourceKind,
                              })
                            }
                            className="rounded-lg border border-red-500/30 px-2 py-1.5 text-red-300 hover:bg-red-500/10"
                            title={copy.stop}
                            aria-label={copy.stop}
                          >
                            <Square className="h-3.5 w-3.5 fill-current" />
                          </button>
                        )}
                        <button
                          onClick={() => openExecution(item)}
                          className="rounded-lg border border-slate-800 px-2 py-1.5 text-slate-300 hover:bg-slate-800"
                        >
                          {copy.open}
                        </button>
                        <button
                          onClick={() => openExecution(item, "logs")}
                          className="rounded-lg border border-slate-800 px-2 py-1.5 text-slate-300 hover:bg-slate-800"
                        >
                          <Terminal className="h-3.5 w-3.5" />
                        </button>
                        {canEdit && (
                          <button
                            onClick={() => relaunch(item)}
                            className="rounded-lg border border-slate-800 px-2 py-1.5 text-slate-300 hover:bg-slate-800"
                            title={copy.relaunch}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(event) =>
                            openActionMenu(event, { kind: "execution", item })
                          }
                          className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:bg-slate-800"
                          aria-label={copy.more}
                          aria-expanded={
                            actionMenu?.kind === "execution" &&
                            actionMenu.item.id === item.id
                          }
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "schedules" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/20">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">{copy.test}</th>
                <th className="px-4 py-3">{copy.target}</th>
                <th className="px-4 py-3">{copy.recurrence}</th>
                <th className="px-4 py-3">{copy.status}</th>
                <th className="px-4 py-3">{copy.nextRun}</th>
                {advancedMode && <th className="px-4 py-3">Cron</th>}
                <th className="px-4 py-3 text-right">{copy.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {loading && !schedules.length ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-14 text-center text-slate-500"
                  >
                    {copy.loading}
                  </td>
                </tr>
              ) : filteredSchedules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center">
                    <p className="text-slate-500">{copy.noSchedules}</p>
                    {canEdit && (
                      <button
                        onClick={() => openWizard("schedule")}
                        className="mt-3 text-xs font-semibold text-purple-400"
                      >
                        {copy.newTest}
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredSchedules.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/20">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openSchedule(item)}
                        className="font-semibold text-slate-100 hover:text-purple-300"
                      >
                        {item.name}
                      </button>
                      <div className="text-[10px] text-slate-600">
                        {templateName(item.scriptName)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      <div>{clusterName(item.clusterId)}</div>
                      <div className="text-[10px] text-slate-600">
                        {item.namespace}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {item.recurrence}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] ${item.active ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-slate-700 bg-slate-800/60 text-slate-400"}`}
                      >
                        {item.active ? copy.active : copy.inactive}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {dateLabel(item.nextRun, lang)}
                    </td>
                    {advancedMode && (
                      <td className="px-4 py-3 font-mono text-slate-500">
                        {item.cron}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openSchedule(item)}
                          className="rounded-lg border border-slate-800 px-2 py-1.5 text-slate-300 hover:bg-slate-800"
                        >
                          {copy.open}
                        </button>
                        {canEdit && (
                          <button
                            onClick={() => runScheduleNow(item)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-800 px-2 py-1.5 text-slate-300 hover:bg-slate-800"
                          >
                            <CirclePlay className="h-3.5 w-3.5" />
                            {copy.runNow}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(event) =>
                            openActionMenu(event, { kind: "schedule", item })
                          }
                          className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:bg-slate-800"
                          aria-label={copy.more}
                          aria-expanded={
                            actionMenu?.kind === "schedule" &&
                            actionMenu.item.id === item.id
                          }
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "scripts" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={scriptCluster}
              onChange={(event) => setScriptCluster(event.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300"
            >
              {clusters.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.name}
                </option>
              ))}
            </select>
            <select
              value={scriptNamespace}
              onChange={(event) => setScriptNamespace(event.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300"
            >
              {scriptNamespaces.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <button
              onClick={loadConfigMaps}
              className="rounded-xl border border-slate-800 p-2 text-slate-400"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">
                {copy.reusableTemplates}
              </h2>
              <Link
                href="/settings"
                className="text-xs text-purple-400 hover:text-purple-300"
              >
                {copy.editInSettings}
              </Link>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Template</th>
                    <th className="px-4 py-3">{copy.type}</th>
                    <th className="px-4 py-3">{copy.parallelism}</th>
                    <th className="px-4 py-3">Script</th>
                    {advancedMode && <th className="px-4 py-3">CPU / RAM</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {templates.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 font-semibold text-slate-200">
                        {item.name}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {item.template_type}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {item.parallelism}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-500">
                        {item.script_name}/{item.script_file}
                      </td>
                      {advancedMode && (
                        <td className="px-4 py-3 text-slate-500">
                          {item.cpu_limit} / {item.mem_limit}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-200">
              {copy.configMaps}
            </h2>
            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">ConfigMap</th>
                    <th className="px-4 py-3">{copy.namespace}</th>
                    <th className="px-4 py-3">{copy.files}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {configMaps.length ? (
                    configMaps.map((item) => (
                      <tr key={`${item.namespace}:${item.name}`}>
                        <td className="px-4 py-3 font-mono font-semibold text-slate-200">
                          {item.name}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {item.namespace || scriptNamespace}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {Object.keys(item.data || {}).join(", ") || "—"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-4 py-12 text-center text-slate-500"
                      >
                        {copy.noScripts}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {activeDrawer && (
        <aside
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-slate-800 bg-slate-950 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-label={activeDrawer.name}
        >
          <div className="flex items-start justify-between border-b border-slate-800 p-5">
            <div>
              <h2 className="text-lg font-bold text-white">
                {activeDrawer.name}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {clusterName(activeDrawer.clusterId)} / {activeDrawer.namespace}
              </p>
            </div>
            <button
              onClick={() => {
                setSelectedExecution(null);
                setSelectedSchedule(null);
              }}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-900 hover:text-white"
              aria-label={copy.close}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex border-b border-slate-800">
            {(
              [
                ["summary", copy.summary, FileText],
                ["metrics", copy.metrics, Gauge],
                ["logs", copy.logs, Terminal],
                ["configuration", copy.configuration, Braces],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => {
                  setDrawerTab(id);
                  if (id === "logs") setLogsLoading(true);
                }}
                disabled={id === "logs" && !selectedExecution}
                className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-3 text-[11px] ${drawerTab === id ? "border-purple-500 text-purple-300" : "border-transparent text-slate-500 disabled:opacity-30"}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {drawerTab === "summary" && (
              <dl className="divide-y divide-slate-800 rounded-2xl border border-slate-800 px-4">
                {selectedExecution ? (
                  <>
                    <div className="flex justify-between py-3 text-xs">
                      <dt className="text-slate-500">{copy.status}</dt>
                      <dd className="text-slate-200">
                        {selectedExecution.state}
                      </dd>
                    </div>
                    <div className="flex justify-between py-3 text-xs">
                      <dt className="text-slate-500">Template</dt>
                      <dd className="text-slate-200">
                        {templateName(selectedExecution.scriptName)}
                      </dd>
                    </div>
                    <div className="flex justify-between py-3 text-xs">
                      <dt className="text-slate-500">{copy.created}</dt>
                      <dd className="text-slate-200">
                        {dateLabel(selectedExecution.createdAt, lang)}
                      </dd>
                    </div>
                  </>
                ) : (
                  selectedSchedule && (
                    <>
                      <div className="flex justify-between py-3 text-xs">
                        <dt className="text-slate-500">{copy.recurrence}</dt>
                        <dd className="text-slate-200">
                          {selectedSchedule.recurrence}
                        </dd>
                      </div>
                      <div className="flex justify-between py-3 text-xs">
                        <dt className="text-slate-500">Cron</dt>
                        <dd className="font-mono text-slate-200">
                          {selectedSchedule.cron}
                        </dd>
                      </div>
                      <div className="flex justify-between py-3 text-xs">
                        <dt className="text-slate-500">{copy.nextRun}</dt>
                        <dd className="text-slate-200">
                          {dateLabel(selectedSchedule.nextRun, lang)}
                        </dd>
                      </div>
                    </>
                  )
                )}
              </dl>
            )}
            {drawerTab === "metrics" && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 text-sm text-slate-400">
                <Gauge className="mb-3 h-6 w-6 text-purple-400" />
                <p>{copy.metricsHint}</p>
                <Link
                  href="/metrics"
                  className="mt-4 inline-block text-xs font-semibold text-purple-400"
                >
                  InfluxDB →
                </Link>
              </div>
            )}
            {drawerTab === "logs" && (
              <pre className="min-h-72 whitespace-pre-wrap rounded-2xl border border-slate-800 bg-slate-900/40 p-4 font-mono text-[11px] leading-5 text-slate-300">
                {logsLoading ? copy.loading : logs || copy.noLogs}
              </pre>
            )}
            {drawerTab === "configuration" && (
              <pre className="whitespace-pre-wrap rounded-2xl border border-slate-800 bg-slate-900/40 p-4 font-mono text-[10px] leading-4 text-slate-400">
                {resourceToYaml(
                  selectedExecution?.raw || selectedSchedule?.raw,
                )}
              </pre>
            )}
          </div>
        </aside>
      )}

      <K6TestWizard
        open={wizardOpen}
        advancedMode={advancedMode}
        initialAction={wizardAction}
        onClose={() => setWizardOpen(false)}
        onCreated={(created) => {
          if (created) {
            const params = new URLSearchParams({ cluster: created.clusterId, namespace: created.namespace });
            if (!created.scheduled) params.set("run", created.name);
            setResultsHref(`/metrics?${params}`);
          }
          setNotice(copy.createdSuccess);
          loadAll();
        }}
      />
      {actionMenu && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label={copy.close}
            onClick={() => setActionMenu(null)}
          />
          <div
            role="menu"
            className="fixed z-50 min-w-44 rounded-xl border border-slate-800 bg-slate-900 p-1 shadow-2xl"
            style={{ top: actionMenu.top, left: actionMenu.left }}
          >
            {actionMenu.kind === "execution" ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const item = actionMenu.item;
                    setActionMenu(null);
                    openExecution(item, "configuration");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800"
                >
                  <Braces className="h-3.5 w-3.5" />
                  {copy.yaml}
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() =>
                      requestDelete({
                        clusterId: actionMenu.item.clusterId,
                        name: actionMenu.item.name,
                        namespace: actionMenu.item.namespace,
                        resourceKind: actionMenu.item.resourceKind,
                      })
                    }
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {copy.delete}
                  </button>
                )}
              </>
            ) : (
              <>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const item = actionMenu.item;
                        setActionMenu(null);
                        setEditSchedule(item);
                        setEditCron(item.cron);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const item = actionMenu.item;
                        setActionMenu(null);
                        toggleSchedule(item);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800"
                    >
                      {actionMenu.item.active ? (
                        <CirclePause className="h-3.5 w-3.5" />
                      ) : (
                        <CirclePlay className="h-3.5 w-3.5" />
                      )}
                      {actionMenu.item.active ? copy.pause : copy.resume}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const item = actionMenu.item;
                    setActionMenu(null);
                    openSchedule(item);
                    setDrawerTab("configuration");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800"
                >
                  <Braces className="h-3.5 w-3.5" />
                  {copy.yaml}
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() =>
                      requestDelete({
                        clusterId: actionMenu.item.clusterId,
                        name: actionMenu.item.name,
                        namespace: actionMenu.item.namespace,
                      })
                    }
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {copy.delete}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
      <Modal
        open={!!deleteTarget}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title={deleteTarget?.action === "stop" ? copy.stopTitle : copy.deleteTitle}
        subtitle={deleteTarget?.name}
      >
        <div className="space-y-5">
          <p className="text-sm text-slate-400">
            {deleteTarget?.action === "stop" ? copy.stopMessage : copy.deleteMessage}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
              className="rounded-xl border border-slate-800 px-4 py-2 text-xs text-slate-300 disabled:opacity-50"
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={removeResource}
              className="rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            >
              {deleting
                ? deleteTarget?.action === "stop"
                  ? copy.stopping
                  : copy.deleting
                : deleteTarget?.action === "stop"
                  ? copy.stop
                  : copy.delete}
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={!!editSchedule}
        onClose={() => setEditSchedule(null)}
        title="Modifier la planification"
        subtitle={editSchedule?.name}
      >
        <div className="space-y-4">
          <label className="block space-y-2 text-xs text-slate-400">
            <span>{copy.cron}</span>
            <input
              value={editCron}
              onChange={(event) => setEditCron(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 font-mono text-slate-200"
            />
          </label>
          <p className="text-xs text-slate-500">
            {describeCron(editCron, lang)}
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditSchedule(null)}
              className="rounded-xl border border-slate-800 px-4 py-2 text-xs text-slate-300"
            >
              {copy.cancel}
            </button>
            <button
              onClick={saveSchedule}
              className="rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white"
            >
              {copy.confirm}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
