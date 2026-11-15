"use client";
import { Activity, Check, Layers3, Network, Unplug } from "lucide-react";
import { usePreferences } from "@/components/PreferencesContext";
import { CombinedAction, CombinedTest, hasChaos } from "@/utils/combinedTest";
import styles from "./K6TestWizard.module.css";

export default function CombinedTestForm({ value, onChange, namespace }: { value: CombinedTest; onChange: (value: CombinedTest) => void; namespace: string }) {
  const { t } = usePreferences();
  const update = (patch: Partial<CombinedTest>) => onChange({ ...value, ...patch });
  const actions = [
    { id: "http" as const, title: "HTTP", description: t("combinedHttp"), Icon: Activity },
    { id: "pod_kill" as const, title: "pod_kill", description: t("combinedKill"), Icon: Unplug },
    { id: "network_latency" as const, title: "network_latency", description: t("combinedLatency"), Icon: Network },
  ];
  const number = (key: keyof CombinedTest, label: string, min = 1, max = 86400) => <label className={styles.field}>
    <span>{label}</span><input type="number" min={min} max={max} value={Number.isFinite(value[key]) ? String(value[key]) : ""} onChange={e => update({ [key]: e.target.value === "" ? NaN : Number(e.target.value) })} />
  </label>;
  const toggle = (id: CombinedAction) => update({ actions: value.actions.includes(id) ? value.actions.filter(a => a !== id) : [...value.actions, id] });
  return <div className={styles.composer}>
    <div className={styles.composerHeader}><div><h3>{t("combinedTitle")}</h3><p>{t("combinedHint")}</p></div>
      <button type="button" className={styles.preset} onClick={() => update({ actions: ["http", "pod_kill", "network_latency"] })}><Layers3 size={16} />{t("combinedPreset")}</button>
    </div>
    <div className={styles.actionGrid}>
      {actions.map(({ id, title, description, Icon }) => <label key={id} className={styles.actionCard} data-selected={value.actions.includes(id)}>
        <input type="checkbox" aria-label={title} checked={value.actions.includes(id)} onChange={() => toggle(id)} />
        <Icon size={21} /><strong>{title}</strong><p>{description}</p>
        {value.actions.includes(id) && <Check className={styles.selectedCheck} size={18} aria-hidden="true" />}
      </label>)}
    </div>
    {value.actions.includes("http") && <fieldset className={styles.panel}><legend>HTTP</legend><div className={styles.fields}>
      <label className={`${styles.field} ${styles.full}`}><span>{t("guidedURL")}</span><input type="url" placeholder="https://api.example.com/health" value={value.url} onChange={e => update({ url: e.target.value })} /></label>
      {number("vus", t("combinedVus"), 1, 10000)}{number("duration", t("combinedDuration"))}
    </div></fieldset>}
    {hasChaos(value) && <fieldset className={styles.panel}><legend>{t("combinedTarget")}</legend>
      <p>{t("combinedNamespace")}: <strong>{namespace || "—"}</strong></p>
      <div className={styles.fields}>
        <label className={styles.field}><span>{t("combinedLabelKey")}</span><input value={value.labelKey} placeholder="app" onChange={e => update({ labelKey: e.target.value })} /></label>
        <label className={styles.field}><span>{t("combinedLabelValue")}</span><input value={value.labelValue} placeholder="checkout" onChange={e => update({ labelValue: e.target.value })} /></label>
      </div><p className={styles.notice}>{t("combinedRequirement")}</p>
    </fieldset>}
    <div className={styles.fields}>
      {value.actions.includes("pod_kill") && <fieldset className={styles.panel}><legend>pod_kill</legend><div className={styles.fields}>
        {number("killStart", t("combinedStart"), 0)}{number("podCount", t("combinedPodCount"), 1, 1000)}
      </div></fieldset>}
      {value.actions.includes("network_latency") && <fieldset className={styles.panel}><legend>network_latency</legend><div className={styles.fields}>
        {number("latencyStart", t("combinedStart"), 0)}{number("latencyDuration", t("combinedDuration"))}
        {number("latencyMs", t("combinedDelay"), 1, 60000)}{number("port", t("combinedPort"), 1, 65535)}
      </div><p>{t("combinedLatencyScope")}</p></fieldset>}
    </div>
    {value.actions.length > 0 && <section className={styles.timeline} aria-label={t("combinedTimeline")}><h4>{t("combinedTimeline")}</h4>
      {value.actions.includes("http") && <p><strong>HTTP</strong><span>0–{value.duration || 0} s · {value.vus || 0} VUs</span></p>}
      {value.actions.includes("pod_kill") && <p><strong>pod_kill</strong><span>{value.killStart || 0} s · {value.podCount || 0} pod(s)</span></p>}
      {value.actions.includes("network_latency") && <p><strong>network_latency</strong><span>{value.latencyStart || 0}–{(value.latencyStart + value.latencyDuration) || 0} s · +{value.latencyMs || 0} ms</span></p>}
    </section>}
  </div>;
}
