'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, Loader2, Bot, Gavel } from 'lucide-react';
import { api, GuardianFinding, GuardianSubjectType, GuardianVerdict } from '@/services/api';
import { usePreferences } from '@/components/PreferencesContext';
import Modal from '@/components/ui/Modal';

interface PreflightPanelProps {
  open: boolean;
  onClose: () => void;
  subjectType: GuardianSubjectType;
  subjectRef: string;
  clusterId?: string;
  namespace?: string;
  environment?: string;
  payload: Record<string, unknown>;
  /** Called once the user chooses to proceed (verdict was pass/warn, or an
   * admin successfully overrode a block). Receives the validation_run_id
   * so the caller can attach it to the actual mutating request. */
  onProceed: (validationRunId: string) => void;
}

interface AgentRow {
  agent: string;
  label: string;
  status: 'analyzing' | 'done';
  finding?: GuardianFinding;
}

const AGENT_LABEL_KEYS: Record<string, string> = {
  'policy-engine': 'guardianPolicyEngineAgent',
  'test-definition-agent': 'guardianTestDefinitionAgent',
  'access-control-agent': 'guardianAccessControlAgent',
  'deployment-safety-agent': 'guardianDeploymentSafetyAgent',
};

function severityIcon(severity?: string) {
  if (severity === 'block') return <ShieldX className="w-4 h-4 text-red-400" />;
  if (severity === 'warn') return <ShieldAlert className="w-4 h-4 text-amber-400" />;
  return <ShieldCheck className="w-4 h-4 text-emerald-400" />;
}

/**
 * Live "pre-flight checklist" for the Guardian multi-agent validation
 * runtime. Starts a validation run, opens an SSE stream, and renders each
 * agent's row as it reports in (spinner -> pass/warn/block), matching a
 * CI-checks-list UX. On BLOCK it offers an admin-only override with a
 * mandatory written justification (audited).
 */
export default function PreflightPanel({
  open,
  onClose,
  subjectType,
  subjectRef,
  clusterId,
  namespace,
  environment,
  payload,
  onProceed,
}: PreflightPanelProps) {
  const { t } = usePreferences();
  const [runId, setRunId] = useState<string | null>(null);
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [verdict, setVerdict] = useState<GuardianVerdict>('pending');
  const [error, setError] = useState('');
  const [overrideNote, setOverrideNote] = useState('');
  const [overriding, setOverriding] = useState(false);
  const [overridden, setOverridden] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const isAdmin = typeof window !== 'undefined' && localStorage.getItem('role') === 'administrator';

  const start = () => {
    setRows([]);
    setVerdict('pending');
    setError('');
    setOverridden(false);
    setOverrideNote('');
    setRunId(null);

    api
      .guardianValidate({ subject_type: subjectType, subject_ref: subjectRef, cluster_id: clusterId, namespace, environment, payload })
      .then(({ id, stream_url }) => {
        setRunId(id);
        const es = new EventSource(stream_url.startsWith('http') ? stream_url : window.location.origin.replace(/\/$/, '') + stream_url);
        eventSourceRef.current = es;
        es.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data);
            if (data.finding) {
              const f: GuardianFinding = data.finding;
              setRows((prev) => {
                const existingIdx = prev.findIndex((r) => r.agent === f.agent);
                const label = AGENT_LABEL_KEYS[f.agent] ? t(AGENT_LABEL_KEYS[f.agent]) : f.agent;
                const row: AgentRow = { agent: f.agent, label, status: 'done', finding: f };
                if (existingIdx >= 0) {
                  const next = [...prev];
                  next[existingIdx] = row;
                  return next;
                }
                return [...prev, row];
              });
            }
            if (data.done) {
              if (data.report?.verdict) setVerdict(data.report.verdict);
              es.close();
            }
          } catch {
            // ignore malformed keep-alive frames
          }
        };
        es.onerror = () => {
          es.close();
        };
      })
      .catch((err) => setError(err.message || t('guardianRunFailed')));
  };

  useEffect(() => {
    if (open) start();
    return () => {
      eventSourceRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const analyzing = runId && verdict === 'pending';
  const canProceed = verdict === 'pass' || verdict === 'warn' || overridden;

  const handleOverride = async () => {
    if (!runId || !overrideNote.trim()) return;
    setOverriding(true);
    try {
      await api.overrideGuardianRun(runId, overrideNote.trim());
      setOverridden(true);
    } catch (err: any) {
      setError(err.message || t('guardianRunFailed'));
    } finally {
      setOverriding(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('guardianTitle')} subtitle={t('guardianSubtitle')} maxWidthClassName="max-w-lg">
      <div className="space-y-4 mt-2">
        {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</div>}

        <div className="space-y-2">
          {rows.length === 0 && !error && (
            <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
              <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
              {t('guardianAnalyzing')}
            </div>
          )}
          {rows.map((row) => (
            <div key={row.agent} className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="mt-0.5">
                {row.agent === 'policy-engine' ? <Gavel className="w-4 h-4 text-slate-400" /> : <Bot className="w-4 h-4 text-slate-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-200">{row.label}</span>
                  {severityIcon(row.finding?.severity)}
                </div>
                {row.finding?.message && <p className="text-[11px] text-slate-400 mt-1 leading-normal">{row.finding.message}</p>}
                {row.finding?.suggested_fix && (
                  <p className="text-[11px] text-purple-300 mt-1">
                    <span className="font-semibold">{t('guardianSuggestedFix')}:</span> {row.finding.suggested_fix}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {!analyzing && rows.length > 0 && (
          <div className="flex items-center justify-between p-3 rounded-xl border bg-slate-900/40 border-slate-800">
            <span className="text-xs font-semibold text-slate-300">{t('guardianOverallVerdict')}</span>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-md border ${
                verdict === 'block'
                  ? 'text-red-400 bg-red-400/10 border-red-400/25'
                  : verdict === 'warn'
                  ? 'text-amber-400 bg-amber-400/10 border-amber-400/25'
                  : 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25'
              }`}
            >
              {verdict === 'block' ? t('guardianBlock') : verdict === 'warn' ? t('guardianWarn') : t('guardianPass')}
            </span>
          </div>
        )}

        {verdict === 'block' && !overridden && (
          <div className="space-y-2 p-3 rounded-xl bg-red-500/5 border border-red-500/20">
            <p className="text-[11px] text-red-300 leading-normal">{t('guardianBlockedMessage')}</p>
            {isAdmin && (
              <>
                <label className="text-[11px] text-slate-400 font-medium">{t('guardianOverrideReasonLabel')}</label>
                <textarea
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  placeholder={t('guardianOverrideReasonPlaceholder')}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500/50"
                />
                <button
                  onClick={handleOverride}
                  disabled={!overrideNote.trim() || overriding}
                  className="w-full py-2 bg-gradient-to-r from-red-600 to-rose-500 hover:from-red-500 hover:to-rose-400 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {overriding ? t('guardianAnalyzing') : t('guardianOverrideSubmit')}
                </button>
              </>
            )}
          </div>
        )}

        {overridden && <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">{t('guardianOverrideSuccess')}</div>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer">
            {t('guardianCancel')}
          </button>
          <button
            onClick={() => runId && onProceed(runId)}
            disabled={!canProceed || !!analyzing}
            className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 disabled:opacity-40 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer"
          >
            {overridden ? t('guardianProceedAnyway') : t('guardianProceed')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
