'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { api, ClusterConfig, ClusterAddonInfo } from '@/services/api';
import { usePreferences } from '@/components/PreferencesContext';

function isEKS(cluster: ClusterConfig) {
  return cluster.auth_type === 'eks-assume-role' || /\.eks\.amazonaws\.com(?:\/|$)|\.api\.aws(?:\/|$)|\.amazonwebservices\.com\.cn(?:\/|$)/.test(cluster.api_server_url || '') || cluster.kubernetes_version?.includes('eks');
}

export default function ClustersPage() {
  const { t, lang } = usePreferences();
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyingMap, setVerifyingMap] = useState<Record<string, 'verifying' | 'connected' | 'failed'>>({});
  const [clusterAddonsMap, setClusterAddonsMap] = useState<Record<string, ClusterAddonInfo[]>>({});
  const [addonsCheckingMap, setAddonsCheckingMap] = useState<Record<string, boolean>>({});
  const [namespacesMap, setNamespacesMap] = useState<Record<string, string[]>>({});

  const [addonErrors, setAddonErrors] = useState<Record<string, boolean>>({});
  const [namespaceErrors, setNamespaceErrors] = useState<Record<string, boolean>>({});
  const [namespacesChecking, setNamespacesChecking] = useState<Record<string, boolean>>({});

  const fetchClusterAddons = useCallback(async (clusterId: string) => {
    setAddonsCheckingMap((prev) => ({ ...prev, [clusterId]: true }));
    setAddonErrors(prev => ({ ...prev, [clusterId]: false }));
    try {
      const data = await api.getClusterAddons(clusterId);
      setClusterAddonsMap((prev) => ({ ...prev, [clusterId]: data || [] }));
      return true;
    } catch {
      setAddonErrors(prev => ({ ...prev, [clusterId]: true }));
      setClusterAddonsMap(prev => ({ ...prev, [clusterId]: [] }));
      return false;
    } finally {
      setAddonsCheckingMap((prev) => ({ ...prev, [clusterId]: false }));
    }
  }, []);

  const fetchNamespaces = useCallback(async (clusterId: string) => {
    setNamespacesChecking(prev => ({ ...prev, [clusterId]: true }));
    setNamespaceErrors(prev => ({ ...prev, [clusterId]: false }));
    try {
      const nsList = await api.getNamespaces(clusterId);
      setNamespacesMap(prev => ({ ...prev, [clusterId]: nsList || [] }));
      return true;
    } catch {
      setNamespaceErrors(prev => ({ ...prev, [clusterId]: true }));
      setNamespacesMap(prev => ({ ...prev, [clusterId]: [] }));
      return false;
    } finally {
      setNamespacesChecking(prev => ({ ...prev, [clusterId]: false }));
    }
  }, []);

  const verifyCluster = useCallback(async (cluster: ClusterConfig) => {
    setVerifyingMap(prev => ({ ...prev, [cluster.id]: 'verifying' }));
    const results = await Promise.all([
      fetchNamespaces(cluster.id),
      ...(isEKS(cluster) ? [fetchClusterAddons(cluster.id)] : []),
    ]);
    setVerifyingMap(prev => ({ ...prev, [cluster.id]: results.every(Boolean) ? 'connected' : 'failed' }));
  }, [fetchNamespaces, fetchClusterAddons]);

  useEffect(() => {
    let cancelled = false;
    api.getClusters().then(data => {
      if (cancelled) return;
      const safeData = data || [];
      setClusters(safeData);
      safeData.forEach(c => { void verifyCluster(c); });
    }).catch(console.error).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [verifyCluster]);

  return (
    <div className="space-y-8 animate-fadeIn">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-slate-100">{t('clustersK8s')}</h2>
        <p className="text-slate-400 text-sm mt-1">
          {t('inspectClusters')}
        </p>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-500">{t('loading')}</div>
      ) : clusters.length === 0 ? (
        <div className="py-12 text-center text-slate-500">{t('noClustersDefined')}</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {clusters.map((cluster) => (
            <div key={cluster.id} className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6">
              
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-4">
                  <div className="p-3 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-2xl">
                    <HardDrive className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-lg font-bold text-slate-200">{cluster.name}</h3>
                      {cluster.k6_operator_installed ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30" title={t('operatorInstalled')}>
                          <span className="w-1.5 h-1.5 mr-1 rounded-full bg-purple-400"></span>
                          {t('k6OperatorLabel')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800/80 text-slate-400 border border-slate-700/50" title={t('operatorNotInstalled')}>
                          {t('noOperator')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">{cluster.api_server_url}</p>
                  </div>
                </div>
                
                <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${
                  verifyingMap[cluster.id] === 'connected' 
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                    : verifyingMap[cluster.id] === 'verifying'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/25 animate-pulse'
                    : 'bg-red-500/10 text-red-400 border-red-500/25'
                }`}>
                  {verifyingMap[cluster.id] === 'connected' ? t('active') : verifyingMap[cluster.id] === 'verifying' ? t('checking') : t('fail')}
                </span>
              </div>

              {/* Cluster Spec grid */}
              <div className="grid grid-cols-2 gap-4 bg-slate-950/40 p-4 rounded-2xl border border-slate-900">
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t('k8sVersion')}</span>
                  <p className="text-xs font-semibold text-slate-300">{cluster.kubernetes_version || t('clusterUnknownVersion')}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t('awsRegion')}</span>
                  <p className="text-xs font-semibold text-slate-300">{cluster.region || 'us-east-1'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">AWS Account ID</span>
                  <p className="text-xs font-semibold text-slate-300">{cluster.aws_account_id || '—'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t('authMech')}</span>
                  <p className="text-xs font-semibold text-slate-300 uppercase">{cluster.auth_type}</p>
                </div>
                <div className="space-y-1 col-span-2">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t('registeredOn')}</span>
                  <p className="text-xs font-semibold text-slate-300">
                    {cluster.created_at ? new Date(cluster.created_at).toLocaleDateString(lang) : '—'}
                  </p>
                </div>
                <div className="space-y-1 col-span-2 border-t border-slate-905/30 pt-3">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t('clusterAllowedNamespaces')}</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {namespacesChecking[cluster.id] ? (
                      <span className="text-xs text-slate-500">{t('checking')}</span>
                    ) : namespaceErrors[cluster.id] ? (
                      <span role="alert" className="text-xs text-amber-400">{t('clusterNamespaceError')}</span>
                    ) : (namespacesMap[cluster.id] || []).length === 0 ? (
                      <span className="text-xs text-slate-500 italic">{t('clusterNoNamespaces')}</span>
                    ) : (
                      (namespacesMap[cluster.id] || []).map(ns => (
                        <span key={ns} className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[10px] font-mono">
                          {ns}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {isEKS(cluster) && (() => {
                const addons = clusterAddonsMap[cluster.id] || [];
                const checking = addonsCheckingMap[cluster.id];
                const failed = addonErrors[cluster.id];
                const pendingUpdates = addons.filter(addon => addon.current !== addon.recommended);
                const healthy = addons.length > 0 && addons.every(addon => addon.status === 'ACTIVE');
                const upToDate = !checking && !failed && healthy && pendingUpdates.length === 0;
                const message = checking ? 'checking' : failed ? 'clusterAddonError' : addons.length === 0 ? 'clusterNoAddons' : !healthy ? 'clusterAddonNotActive' : pendingUpdates.length > 0 ? 'eksAddonUpdatesRecommended' : 'allAddonsUpToDate';
                return (
                  <div className={`p-4 border rounded-2xl space-y-3 text-xs ${upToDate ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400' : 'bg-amber-500/5 border-amber-500/15 text-amber-400'}`}>
                    <div role={failed ? 'alert' : 'status'} className="flex items-center gap-2 font-semibold">
                      {checking ? <RefreshCw className="w-4 h-4 animate-spin" /> : upToDate ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                      <span>{t(message)}</span>
                    </div>
                    {!checking && !failed && pendingUpdates.length > 0 && (
                      <div className="space-y-2 text-slate-400">
                        <p>{t('clusterAddonVersions')}</p>
                        {pendingUpdates.map(addon => (
                          <div key={addon.name} className="flex flex-wrap justify-between gap-2 border-t border-slate-700/20 pt-2">
                            <span className="font-mono text-slate-300">{addon.name}</span>
                            <span className="font-mono text-[10px]">
                              {addon.current} → <span className={addon.current !== addon.recommended ? 'text-amber-400 font-semibold' : ''}>{addon.recommended}</span>
                              {addon.status !== 'ACTIVE' && <span className="ms-2 text-amber-400">({addon.status})</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex space-x-3 pt-2">
                <button
                  onClick={() => verifyCluster(cluster)}
                  disabled={verifyingMap[cluster.id] === 'verifying'}
                  className="flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-800/40 text-slate-300 hover:text-slate-100 transition duration-300 text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${verifyingMap[cluster.id] === 'verifying' ? 'animate-spin' : ''}`} />
                  <span>{t('testConn')}</span>
                </button>
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  );
}
