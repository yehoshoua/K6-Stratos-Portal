'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Consistent empty/zero-data state for lists, tables, and panels across
 * the app — replaces the ad-hoc "py-12 text-center text-slate-500"
 * `<div>` that used to be re-implemented on every page.
 */
export default function EmptyState({ icon: Icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`py-12 flex flex-col items-center justify-center text-center gap-2 ${className}`}>
      {Icon && (
        <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-slate-500 mb-2">
          <Icon className="w-5 h-5" />
        </div>
      )}
      <p className="text-sm font-medium text-slate-400">{title}</p>
      {description && <p className="text-xs text-slate-500 max-w-sm">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
