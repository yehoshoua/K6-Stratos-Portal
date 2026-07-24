'use client';

import React, { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { OnMount } from '@monaco-editor/react';
import { Activity } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesContext';
import K6StagesVisualEditor from '@/components/K6StagesVisualEditor';
import {
  enableVisualStagesInScript,
  scriptHasStages,
} from '@/utils/k6ScriptStages';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[200px] items-center justify-center text-xs text-slate-500">
      Loading editor…
    </div>
  ),
});

const handleK6EditorMount: OnMount = (_editor, monaco) => {
  monaco.languages.typescript.javascriptDefaults.setExtraLibs([
    {
      content: `
        declare module 'k6' {
          export function sleep(seconds: number): void;
          export function check<T>(val: T, sets: { [key: string]: (val: T) => boolean }): boolean;
          export function fail(message?: string): never;
        }
        declare module 'k6/http' {
          export interface Response {
            status: number;
            body: string;
            json(): any;
            headers: { [key: string]: string };
          }
          export function get(url: string, params?: any): Response;
          export function post(url: string, body?: any, params?: any): Response;
          export function put(url: string, body?: any, params?: any): Response;
          export function del(url: string, body?: any, params?: any): Response;
        }
        declare module 'k6/metrics' {
          export class Counter {
            constructor(name: string, trend?: boolean);
            add(value: number, tags?: any): void;
          }
          export class Trend {
            constructor(name: string, trend?: boolean);
            add(value: number, tags?: any): void;
          }
          export class Gauge {
            constructor(name: string, trend?: boolean);
            add(value: number, tags?: any): void;
          }
          export class Rate {
            constructor(name: string, trend?: boolean);
            add(value: number, tags?: any): void;
          }
        }
      `,
      filePath: 'ts:k6.d.ts',
    },
  ]);
};

interface K6ScriptEditorProps {
  script: string;
  onChange: (script: string) => void;
  editorKey?: string;
  label?: string;
  height?: string;
  layout?: 'stack' | 'split';
}

export default function K6ScriptEditor({
  script,
  onChange,
  editorKey,
  label,
  height = '320px',
  layout = 'stack',
}: K6ScriptEditorProps) {
  const { t } = usePreferences();
  const hasStages = scriptHasStages(script);
  const showSplit = layout === 'split' && hasStages;
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const skipExternalSyncRef = useRef(false);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    handleK6EditorMount(editor, monaco);
    if (script && editor.getValue() !== script) {
      editor.setValue(script);
    }
    window.requestAnimationFrame(() => editor.layout());
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (skipExternalSyncRef.current) {
      skipExternalSyncRef.current = false;
      return;
    }
    const currentValue = editor.getValue();
    if (currentValue !== script) {
      const position = editor.getPosition();
      editor.setValue(script);
      if (position) {
        editor.setPosition(position);
      }
    }
    window.requestAnimationFrame(() => editor.layout());
  }, [script, editorKey]);

  const monacoBlock = (
    <div className="block space-y-2 text-xs text-slate-400">
      <span>{label || t('jsScriptContent')}</span>
      <div
        className="border border-slate-800 rounded-xl overflow-hidden"
        style={{ height, minHeight: height }}
      >
        <MonacoEditor
          key={editorKey || 'k6-script-editor'}
          height={height}
          defaultLanguage="javascript"
          theme="vs-dark"
          defaultValue={script}
          onChange={(value) => {
            skipExternalSyncRef.current = true;
            onChange(value ?? '');
          }}
          onMount={handleEditorMount}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: 'on',
            roundedSelection: false,
            scrollBeyondLastLine: false,
            readOnly: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
          }}
        />
      </div>
      {!hasStages && (
        <button
          type="button"
          onClick={() => onChange(enableVisualStagesInScript(script))}
          className="mt-2 flex items-center space-x-2 text-xs font-semibold text-purple-400 hover:text-purple-300 transition cursor-pointer"
        >
          <Activity className="w-4 h-4" />
          <span>{t('enableVisualStages')}</span>
        </button>
      )}
    </div>
  );

  const stagesBlock = hasStages ? (
    <K6StagesVisualEditor script={script} onChange={onChange} showStageList />
  ) : null;

  return (
    <div className={showSplit ? 'grid grid-cols-1 lg:grid-cols-2 gap-8' : 'space-y-4'}>
      <div className="min-w-0">{monacoBlock}</div>
      {showSplit && (
        <div className="min-w-0 border-t lg:border-t-0 lg:border-l border-slate-800 pt-6 lg:pt-0 lg:pl-8">
          {stagesBlock}
        </div>
      )}
      {!showSplit && stagesBlock}
    </div>
  );
}
