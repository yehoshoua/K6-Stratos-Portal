"use client";
import { usePreferences } from "@/components/PreferencesContext";
import type { GuidedTest } from "@/utils/guidedTest";

export default function GuidedHTTPForm({ value, onChange }: { value: GuidedTest; onChange: (next: GuidedTest) => void }) {
  const { t } = usePreferences();
  const inputClass = "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100";
  const update = <K extends keyof GuidedTest>(key: K, next: GuidedTest[K]) => onChange({ ...value, [key]: next });
  return <section className="space-y-4 rounded-2xl border border-purple-500/30 p-4">
    <div><h3 className="font-semibold">{t("guidedTitle")}</h3><p className="text-xs text-slate-400">{t("guidedHint")}</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-xs sm:col-span-2">{t("guidedURL")}<input className={inputClass} type="url" value={value.url} onChange={e => update("url", e.target.value)} /></label>
      <label className="text-xs">{t("guidedMethod")}<select className={inputClass} value={value.method} onChange={e => update("method", e.target.value as GuidedTest["method"])}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map(method => <option key={method}>{method}</option>)}</select></label>
      <label className="text-xs">{t("guidedAuth")}<select className={inputClass} value={value.auth} onChange={e => update("auth", e.target.value as GuidedTest["auth"])}><option value="none">{t("guidedNoAuth")}</option><option value="bearer">{t("guidedBearer")}</option></select></label>
      {value.auth === "bearer" && <>
        <label className="text-xs">{t("guidedSecretName")}<input className={inputClass} value={value.secretName} onChange={e => update("secretName", e.target.value)} /></label>
        <label className="text-xs">{t("guidedSecretKey")}<input className={inputClass} value={value.secretKey} onChange={e => update("secretKey", e.target.value)} /></label>
      </>}
      {([ ["vus", "guidedVUs", 1, 10000], ["durationSeconds", "guidedDuration", 1, 3600], ["p95Ms", "guidedP95", 1, 3600000], ["maxErrorPercent", "guidedErrorRate", 0, 100] ] as const).map(([key, label, min, max]) => <label className="text-xs" key={key}>{t(label)}<input className={inputClass} type="number" min={min} max={max} step={key === "maxErrorPercent" ? "0.1" : "1"} value={value[key]} onChange={e => update(key, Number(e.target.value))} /></label>)}
      {value.method !== "GET" && <label className="text-xs sm:col-span-2">{t("guidedBody")}<textarea className={inputClass} rows={4} value={value.body} onChange={e => update("body", e.target.value)} /></label>}
    </div>
  </section>;
}
