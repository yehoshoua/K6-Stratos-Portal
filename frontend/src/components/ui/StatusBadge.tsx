'use client';

import React from 'react';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25',
  warning: 'text-amber-400 bg-amber-400/10 border-amber-400/25',
  danger: 'text-red-400 bg-red-400/10 border-red-400/25',
  info: 'text-blue-400 bg-blue-400/10 border-blue-400/25',
  neutral: 'text-slate-400 bg-slate-500/10 border-slate-500/25',
};

interface StatusBadgeProps {
  tone: StatusTone;
  children: React.ReactNode;
  pulse?: boolean;
  className?: string;
}

/**
 * Shared status pill used across the dashboard, clusters, CRDs, schedules,
 * and Guardian views so severity/status colors stay consistent instead of
 * every page re-deriving its own className map.
 */
export default function StatusBadge({ tone, children, pulse, className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md border font-medium ${TONE_CLASSES[tone]} ${className}`}
    >
      {pulse && <span className={`w-1.5 h-1.5 rounded-full ${TONE_CLASSES[tone].split(' ')[0].replace('text-', 'bg-')} animate-pulse`} />}
      {children}
    </span>
  );
}
