'use client';

import React, { useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { usePreferences } from './PreferencesContext';

interface K6Stage {
  duration: string;
  target: number;
}

interface ChartPoint {
  x: number;
  y: number;
  time: number;
  target: number;
}

const parseDuration = (duration: string): number => {
  const match = duration.trim().match(/^(\d+)([smh])$/);
  if (!match) return 0;
  const value = Number(match[1]);
  return match[2] === 'h' ? value * 3600 : match[2] === 'm' ? value * 60 : value;
};

const formatDuration = (seconds: number): string => {
  const value = Math.max(1, Math.round(seconds));
  if (value % 3600 === 0) return `${value / 3600}h`;
  if (value % 60 === 0) return `${value / 60}m`;
  return `${value}s`;
};

const parseStages = (script: string): K6Stage[] => {
  const stagesMatch = script.match(/stages:\s*\[([\s\S]*?)\]/);
  if (!stagesMatch) return [];
  const stages: K6Stage[] = [];
  const objects = stagesMatch[1].matchAll(/\{([\s\S]*?)\}/g);
  for (const object of objects) {
    const duration = object[1].match(/duration:\s*['"`]([^'"`]+)['"`]/)?.[1];
    const target = object[1].match(/target:\s*(\d+)/)?.[1];
    if (duration && target) stages.push({ duration, target: Number(target) });
  }
  return stages;
};

const updateScriptStages = (script: string, stages: K6Stage[]): string => {
  const body = stages.map((stage) => `        { duration: '${stage.duration}', target: ${stage.target} }`).join(',\n');
  return script.replace(/stages:\s*\[[\s\S]*?\]/, `stages: [\n${body}\n      ]`);
};

export default function K6StagesVisualEditor({ script, onChange }: { script: string; onChange: (script: string) => void }) {
  const { t } = usePreferences();
  const stages = parseStages(script);
  const [draggedStage, setDraggedStage] = useState<number | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (stages.length === 0) return null;

  const totalDuration = stages.reduce((total, stage) => total + parseDuration(stage.duration), 0);
  const maxTime = Math.max(Math.ceil(totalDuration * 1.25), 60);
  const maxTarget = Math.max(Math.ceil(Math.max(...stages.map((stage) => stage.target), 10) * 1.25), 10);
  const points: ChartPoint[] = [{ x: 30, y: 130, time: 0, target: 0 }];
  let elapsed = 0;
  for (const stage of stages) {
    elapsed += parseDuration(stage.duration);
    points.push({
      x: 30 + (elapsed / maxTime) * 340,
      y: 130 - (stage.target / maxTarget) * 110,
      time: elapsed,
      target: stage.target,
    });
  }
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} 130 L 30 130 Z`;

  const updateFromPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    if (draggedStage === null || !svgRef.current) return;
    const matrix = svgRef.current.getScreenCTM();
    if (!matrix) return;
    const cursor = svgRef.current.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const position = cursor.matrixTransform(matrix.inverse());
    const x = Math.min(370, Math.max(30, position.x));
    const y = Math.min(130, Math.max(20, position.y));
    const target = Math.max(0, Math.round(((130 - y) / 110) * maxTarget));
    const previousTotal = stages.slice(0, draggedStage).reduce((total, stage) => total + parseDuration(stage.duration), 0);
    const requestedTotal = Math.round(((x - 30) / 340) * maxTime);
    const currentDuration = parseDuration(stages[draggedStage].duration);
    const nextDuration = draggedStage < stages.length - 1 ? parseDuration(stages[draggedStage + 1].duration) : 0;
    const maximumTotal = draggedStage < stages.length - 1
      ? previousTotal + currentDuration + nextDuration - 1
      : maxTime;
    const duration = Math.max(1, Math.min(maximumTotal - previousTotal, requestedTotal - previousTotal));
    const nextStages = [...stages];
    nextStages[draggedStage] = { duration: formatDuration(duration), target };
    if (draggedStage < nextStages.length - 1) {
      nextStages[draggedStage + 1] = {
        ...nextStages[draggedStage + 1],
        duration: formatDuration(currentDuration + nextDuration - duration),
      };
    }
    onChange(updateScriptStages(script, nextStages));
  };

  return (
    <section className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/80 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
        <Activity className="w-4 h-4 text-purple-400" />
        {t('visualStagesTitle')}
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 400 150"
        className="w-full h-auto touch-none"
        onPointerMove={updateFromPointer}
        onPointerUp={() => setDraggedStage(null)}
        onPointerCancel={() => setDraggedStage(null)}
        aria-label={t('visualStagesTitle')}
      >
        <path d={areaPath} fill="rgba(168, 85, 247, 0.18)" />
        <path d={linePath} fill="none" stroke="rgb(168, 85, 247)" strokeWidth="2" strokeLinecap="round" />
        {points.map((point, index) => (
          <g key={index}>
            {index > 0 && (
              <circle
                cx={point.x}
                cy={point.y}
                r="12"
                fill="transparent"
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(event) => {
                  event.preventDefault();
                  svgRef.current?.setPointerCapture(event.pointerId);
                  setDraggedStage(index - 1);
                  setHoveredPoint(index);
                }}
              />
            )}
            <circle
              cx={point.x}
              cy={point.y}
              r={hoveredPoint === index || draggedStage === index - 1 ? 6 : 4}
              fill={index === 0 ? 'rgb(148, 163, 184)' : 'rgb(168, 85, 247)'}
              stroke="rgb(15, 23, 42)"
              strokeWidth="2"
              className={index === 0 ? '' : 'cursor-grab active:cursor-grabbing'}
              onMouseEnter={() => setHoveredPoint(index)}
              onMouseLeave={() => draggedStage === null && setHoveredPoint(null)}
            />
          </g>
        ))}
      </svg>
      {hoveredPoint !== null && points[hoveredPoint] && (
        <p className="text-[11px] text-slate-400">
          {hoveredPoint === 0 ? '0 VUs' : `${points[hoveredPoint].target} VUs · ${formatDuration(points[hoveredPoint].time)}`}
        </p>
      )}
    </section>
  );
}
