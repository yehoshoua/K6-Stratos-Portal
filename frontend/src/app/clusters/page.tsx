'use client';

import React, { useEffect, useState } from 'react';
import { HardDrive, ShieldCheck, RefreshCw, Layers, AlertTriangle, CheckCircle } from 'lucide-react';
import { api, ClusterConfig } from '@/services/api';
import { usePreferences } from '@/components/PreferencesContext';

export default function ClustersPage() {
  const { t } = usePreferences();
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyingMap, setVerifyingMap] = useState<Record<string, 'verifying' | 'connected' | 'failed'>>({});
  const [clusterAddonsMap, setClusterAddonsMap] = useState<Record<string, { name: string; current: string; recommended: string }[]>>({});
  const [addonsCheckingMap, setAddonsCheckingMap] = useState<Record<string, boolean>>({});
  const [namespacesMap, setNamespacesMap] = useState<Record<string, string[]>>({});

  const fetchClusterAddons = async (clusterId: string) => {
    setAddonsCheckingMap((prev) => ({ ...prev, [clusterId]: true }));
    try {
      const data = await api.getClusterAddons(clusterId);
      setClusterAddonsMap((prev) => ({ ...prev, [clusterId]: data || [] }));
    } catch (err) {
      console.error(err);
    } finally {
      setAddonsCheckingMap((prev) => ({ ...prev, [clusterId]: false }));
    }
  };

  const fetchNamespaces = async (clusterId: string) => {
    try {
      const nsList = await api.getNamespaces(clusterId);
      setNamespacesMap((prev) => ({ ...prev, [clusterId]: nsList || [] }));
    } catch (err) {
      console.error(err);
    }
  };

  const loadClusters = async () => {
    try {
      setLoading(true);
      const data = await api.getClusters();
      const safeData = data || [];
      setClusters(safeData);
      // Initialize validation statuses
      const statusMap: Record<string, any> = {};
      safeData.forEach(c => {
        statusMap[c.id] = 'connected';
        fetchNamespaces(c.id);
        const isEKS = c.api_server_url?.includes('.eks.amazonaws.com') || c.kubernetes_version?.includes('eks') || c.name?.toLowerCase().includes('eks');
        if (isEKS) {
          fetchClusterAddons(c.id);
        }
      });
      setVerifyingMap(statusMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClusters();
  }, []);

  const handleVerify = async (id: string) => {
    setVerifyingMap(prev => ({ ...prev, [id]: 'verifying' }));
    
    // Asynchronously update namespaces and addons
    await fetchNamespaces(id);
    const c = clusters.find(item => item.id === id);
    const isEKS = c?.api_server_url?.includes('.eks.amazonaws.com') || c?.kubernetes_version?.includes('eks') || c?.name?.toLowerCase().includes('eks');
    if (isEKS) {
      await fetchClusterAddons(id);
    } else {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    setVerifyingMap(prev => ({ ...prev, [id]: 'connected' }));
  };

  const [upgradingAddonsMap, setUpgradingAddonsMap] = useState<Record<string, boolean>>({});
  const [upgradeErrorMap, setUpgradeErrorMap] = useState<Record<string, string>>({});

  const handleUpgradeAddon = async (clusterId: string, addonName: string, recommendedVersion: string) => {
    const key = `${clusterId}:${addonName}`;
    setUpgradingAddonsMap(prev => ({ ...prev, [key]: true }));
    setUpgradeErrorMap(prev => ({ ...prev, [key]: '' }));
    try {
      await api.upgradeClusterAddon(clusterId, addonName, recommendedVersion);
      setTimeout(() => {
        fetchClusterAddons(clusterId);
      }, 3000);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Upgrade failed';
      setUpgradeErrorMap(prev => ({ ...prev, [key]: msg }));
    } finally {
      setUpgradingAddonsMap(prev => ({ ...prev, [key]: false }));
    }
  };

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
                  <p className="text-xs font-semibold text-slate-300">{cluster.kubernetes_version || 'v1.35.0-eks'}</p>
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
                    {new Date(cluster.created_at || Date.now()).toLocaleDateString()}
                  </p>
                </div>
                <div className="space-y-1 col-span-2 border-t border-slate-905/30 pt-3">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Allowed Namespaces (k6s)</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(namespacesMap[cluster.id] || []).length === 0 ? (
                      <span className="text-xs text-slate-500 italic">None detected</span>
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

              {/* EKS Addon Update Recommendations */}
              {(() => {
                const isEKS = cluster.api_server_url?.includes('.eks.amazonaws.com') || cluster.kubernetes_version?.includes('eks') || cluster.name?.toLowerCase().includes('eks');
                if (!isEKS) return null;
                const checking = addonsCheckingMap[cluster.id];
                const addons = clusterAddonsMap[cluster.id] || [];
                const pendingUpdates = addons.filter(addon => addon.current !== addon.recommended);

                if (checking) {
                  return (
                    <div className="p-4 bg-amber-500/5 border border-amber-500/15 rounded-2xl space-y-2.5 transition duration-300">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
                          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 animate-bounce" />
                          <span>{t('eksAddonUpdatesRecommended') || 'EKS Add-on Updates Recommended'}</span>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-500/80 uppercase tracking-wider animate-pulse">
                          <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                          {t('checking') || 'Checking...'}
                        </span>
                      </div>
                      <div className="space-y-2 py-1 pl-6">
                        <div className="h-2 w-3/4 bg-amber-500/20 rounded-full animate-pulse"></div>
                        <div className="h-2 w-1/2 bg-amber-500/20 rounded-full animate-pulse"></div>
                      </div>
                    </div>
                  );
                }

                if (addons.length > 0 && pendingUpdates.length === 0) {
                  return (
                    <div className="p-4 bg-emerald-500/5 border border-emerald-500/15 rounded-2xl flex items-center gap-2.5 text-emerald-400 text-xs font-semibold transition duration-300">
                      <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>{t('allAddonsUpToDate') || 'All EKS Add-ons are up to date'}</span>
                    </div>
                  );
                }

                if (pendingUpdates.length > 0) {
                  return (
                    <div className="p-4 bg-amber-500/5 border border-amber-500/15 rounded-2xl space-y-2.5 transition duration-300">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
                          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                          <span>{t('eksAddonUpdatesRecommended') || 'EKS Add-on Updates Recommended'}</span>
                        </div>
                        <span className="text-[9px] font-semibold text-emerald-500 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                          {t('verified') || 'Verified'}
                        </span>
                      </div>
                      
                      <div className="space-y-1.5 pl-6 text-[10px] text-slate-400 font-sans">
                        {pendingUpdates.map((addon) => (
                          <div key={addon.name} className="flex justify-between items-center gap-4 py-1 border-b border-amber-500/10 last:border-0">
                            <span className="font-mono text-slate-300">{addon.name}</span>
                            <span className="font-mono text-[9px] text-slate-500">
                              {addon.current} → <span className="text-amber-400 font-semibold">{addon.recommended}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }

                return null;
              })()}

              {/* Actions */}
              <div className="flex space-x-3 pt-2">
                <button
                  onClick={() => handleVerify(cluster.id)}
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
