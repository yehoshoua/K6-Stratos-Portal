'use client';

import { useState, useCallback, useRef } from 'react';
import { scriptHasStages, parseStagesFromScript, updateStagesInScript, K6Stage } from '@/utils/k6ScriptStages';

/**
 * Hook pour gérer l'état d'un script K6 avec parsing et manipulation des stages
 */
export function useK6Script(initialScript: string = '') {
  const [script, setScriptState] = useState(initialScript);
  const skipExternalSyncRef = useRef(false);

  const setScript = useCallback((newScript: string) => {
    skipExternalSyncRef.current = false;
    setScriptState(newScript);
  }, []);

  const hasStages = scriptHasStages(script);
  const stages = parseStagesFromScript(script);

  const updateStages = useCallback((newStages: K6Stage[]) => {
    const updated = updateStagesInScript(script, newStages);
    setScript(updated);
  }, [script, setScript]);

  return {
    script,
    setScript,
    hasStages,
    stages,
    updateStages,
    skipExternalSyncRef,
  };
}

interface TemplateConfig {
  id: string;
  name: string;
  templateType: string;
  parallelism: number;
  scriptContent: string;
  scriptName: string;
  runnerImage: string;
  cpuLimit: string;
  memLimit: string;
  slaThresholds: Record<string, any>;
  scheduleEnabled: boolean;
  scheduleCronExpression: string;
  scheduleActive: boolean;
  scheduleClusterID: string;
  scheduleNamespace: string;
}

const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  id: '',
  name: '',
  templateType: 'testrun',
  parallelism: 1,
  scriptContent: '',
  scriptName: '',
  runnerImage: '',
  cpuLimit: '500m',
  memLimit: '512Mi',
  slaThresholds: {},
  scheduleEnabled: false,
  scheduleCronExpression: '',
  scheduleActive: false,
  scheduleClusterID: '',
  scheduleNamespace: '',
};

/**
 * Hook pour gérer le state et les opérations de templates K6
 */
export function useK6TemplateEditor() {
  const [templateConfig, setTemplateConfig] = useState<TemplateConfig>(DEFAULT_TEMPLATE_CONFIG);

  const updateField = useCallback((field: keyof TemplateConfig, value: any) => {
    setTemplateConfig((prev: TemplateConfig) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const updateNestedField = useCallback((parentField: keyof TemplateConfig, field: string, value: any) => {
    setTemplateConfig((prev: TemplateConfig) => ({
      ...prev,
      [parentField]: {
        ...(prev[parentField] as Record<string, any>),
        [field]: value,
      },
    }));
  }, []);

  const reset = useCallback((newConfig: Partial<TemplateConfig> = {}) => {
    setTemplateConfig({
      ...DEFAULT_TEMPLATE_CONFIG,
      ...newConfig,
    });
  }, []);

  return {
    templateConfig,
    setTemplateConfig,
    updateField,
    updateNestedField,
    reset,
  };
}
