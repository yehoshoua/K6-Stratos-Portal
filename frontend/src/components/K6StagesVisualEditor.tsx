'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Activity, Plus, Trash2 } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesContext';
import {
  K6Stage,
  parseStagesFromScript,
  updateStagesInScript,
} from '@/utils/k6ScriptStages';

interface K6StagesVisualEditorProps {
  script: string;
  onChange: (script: string) => void;
  showStageList?: boolean;
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

function parseDurationToSeconds(duration: string): number {
  let seconds = 0;
  const minutes = duration.match(/(\d+)m/);
  const secs = duration.match(/(\d+)s/);
  if (minutes) seconds += parseInt(minutes[1], 10) * 60;
  if (secs) seconds += parseInt(secs[1], 10);
  return seconds || 60;
}

function generateSvgPaths(stages: K6Stage[]) {
  if (stages.length === 0) return { linePath: '', areaPath: '', points: [] };

  const points: { x: number; y: number; vu: number; time: number; label: string }[] = [];
  let currentTime = 0;
  let maxVu = 0;
  let maxTime = 0;

  points.push({ x: 30, y: 130, vu: 0, time: 0, label: 'Start' });

  stages.forEach((stage, index) => {
    const durationSec = parseDurationToSeconds(stage.duration);
    currentTime += durationSec;
    maxVu = Math.max(maxVu, stage.target);
    maxTime = Math.max(maxTime, currentTime);
    points.push({
      x: 0,
      y: 0,
      vu: stage.target,
      time: currentTime,
      label: `Stage ${index + 1}`,
    });
  });

  const chartWidth = 340;
  const chartHeight = 110;
  const startX = 30;
  const startY = 20;

  points.forEach((point, index) => {
    if (index === 0) return;
    point.x = startX + (point.time / maxTime) * chartWidth;
    point.y = startY + chartHeight - (point.vu / (maxVu || 1)) * chartHeight;
  });

  let linePath = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    linePath += ` L ${points[i].x} ${points[i].y}`;
  }

  const areaPath = `${linePath} L ${points[points.length - 1].x} 130 L ${points[0].x} 130 Z`;
  return { linePath, areaPath, points };
}

export default function K6StagesVisualEditor({ script, onChange, showStageList = false }: K6StagesVisualEditorProps) {
  const { t } = usePreferences();
  const stages = useMemo(() => parseStagesFromScript(script), [script]);
  const { linePath, areaPath, points } = useMemo(() => generateSvgPaths(stages), [stages]);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  const [draggedStage, setDraggedStage] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement>(null);

  const handleUpdateStages = useCallback(
    (newStages: K6Stage[]) => {
      onChange(updateStagesInScript(script, newStages));
    },
    [onChange, script],
  );

  const updateStageFromPointer = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (draggedStage === null || !chartRef.current) return;

      const rect = chartRef.current.getBoundingClientRect();
      const relativeY = (event.clientY - rect.top) / rect.height;
      const maxVu = Math.max(...stages.map((stage) => stage.target), 1);
      const newTarget = Math.max(0, Math.round(maxVu * (1 - relativeY)));

      const newStages = [...stages];
      newStages[draggedStage] = { ...newStages[draggedStage], target: newTarget };
      handleUpdateStages(newStages);
    },
    [draggedStage, handleUpdateStages, stages],
  );

  if (stages.length === 0) return null;

  return (
    <div className="space-y-4 flex flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Activity className="w-5 h-5 text-purple-500" />
          <h4 className="text-sm font-bold text-white">{t('visualStagesTitle')}</h4>
        </div>
      </div>

      <div className="bg-slate-950 border border-slate-850 rounded-2xl p-4 relative overflow-hidden">
        <div className="absolute top-3 right-4 text-[10px] font-medium text-slate-400 bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
          {hoveredPoint !== null && points[hoveredPoint] ? (
            <span>
              {points[hoveredPoint].label}: <strong className="text-purple-400">{points[hoveredPoint].vu} VUs</strong> @{' '}
              {formatSeconds(points[hoveredPoint].time)}
            </span>
          ) : (
            <span>{t('visualChart')}</span>
          )}
        </div>

        <svg
          ref={chartRef}
          viewBox="0 0 400 150"
          className="w-full h-auto mt-4 touch-none"
          onPointerMove={updateStageFromPointer}
          onPointerUp={() => setDraggedStage(null)}
          onPointerCancel={() => setDraggedStage(null)}
        >
          <defs>
            <linearGradient id="k6ChartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(168, 85, 247)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="rgb(168, 85, 247)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          <line x1="30" y1="20" x2="370" y2="20" stroke="rgba(148, 163, 184, 0.05)" strokeWidth="1" />
          <line x1="30" y1="57" x2="370" y2="57" stroke="rgba(148, 163, 184, 0.05)" strokeWidth="1" />
          <line x1="30" y1="94" x2="370" y2="94" stroke="rgba(148, 163, 184, 0.05)" strokeWidth="1" />
          <line x1="30" y1="130" x2="370" y2="130" stroke="rgba(148, 163, 184, 0.05)" strokeWidth="1" />
          <line x1="30" y1="20" x2="30" y2="130" stroke="rgba(148, 163, 184, 0.05)" strokeWidth="1" />
          <line x1="143" y1="20" x2="143" y2="130" stroke="rgba(148, 163, 184, 0.05)" strokeWidth="1" />
          <line x1="256" y1="20" x2="256" y2="130" stroke="rgba(148, 163, 184, 0.05)" strokeWidth="1" />
          <line x1="370" y1="20" x2="370" y2="130" stroke="rgba(148, 163, 184, 0.05)" strokeWidth="1" />

          {areaPath && <path d={areaPath} fill="url(#k6ChartGradient)" />}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="rgb(168, 85, 247)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {points.map((point, idx) => (
            <g key={idx}>
              {idx > 0 && (
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="12"
                  fill="transparent"
                  className="cursor-grab active:cursor-grabbing"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    chartRef.current?.setPointerCapture(event.pointerId);
                    setDraggedStage(idx - 1);
                    setHoveredPoint(idx);
                  }}
                />
              )}
              <circle
                cx={point.x}
                cy={point.y}
                r={hoveredPoint === idx || draggedStage === idx - 1 ? 6 : 4}
                fill={idx === 0 ? 'rgb(148, 163, 184)' : 'rgb(168, 85, 247)'}
                stroke="rgb(15, 23, 42)"
                strokeWidth="2"
                className={idx === 0 ? 'transition-all duration-150' : 'transition-all duration-150 cursor-grab active:cursor-grabbing'}
                onMouseEnter={() => setHoveredPoint(idx)}
                onMouseLeave={() => draggedStage === null && setHoveredPoint(null)}
              />
            </g>
          ))}
        </svg>
      </div>

      {showStageList && (
        <>
          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
            {stages.map((stage, idx) => (
              <div
                key={idx}
                className="flex items-center space-x-3 bg-slate-950/60 border border-slate-850 p-3 rounded-xl hover:border-slate-800 transition"
              >
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      {t('duration')}
                    </label>
                    <input
                      type="text"
                      required
                      value={stage.duration}
                      onChange={(e) => {
                        const newStages = [...stages];
                        newStages[idx] = { ...newStages[idx], duration: e.target.value };
                        handleUpdateStages(newStages);
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono"
                      placeholder="e.g., 2m"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      {t('targetVUs')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={stage.target}
                      onChange={(e) => {
                        const newStages = [...stages];
                        newStages[idx] = { ...newStages[idx], target: parseInt(e.target.value, 10) || 0 };
                        handleUpdateStages(newStages);
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                      placeholder="e.g., 50"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleUpdateStages(stages.filter((_, i) => i !== idx))}
                  className="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition cursor-pointer mt-4"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              const lastStage = stages[stages.length - 1];
              const newStage = lastStage
                ? { duration: lastStage.duration, target: lastStage.target }
                : { duration: '1m', target: 10 };
              handleUpdateStages([...stages, newStage]);
            }}
            className="w-full py-2 border border-dashed border-slate-800 hover:border-purple-500/50 hover:bg-purple-500/5 text-purple-400 hover:text-purple-300 rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t('addStage')}</span>
          </button>
        </>
      )}
    </div>
  );
}
