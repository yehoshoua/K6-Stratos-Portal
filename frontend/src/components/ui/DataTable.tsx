'use client';

import React from 'react';
import EmptyState from './EmptyState';
import type { LucideIcon } from 'lucide-react';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  loadingLabel?: string;
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
}

/**
 * Compact, dense data table matching the operational-dashboard style
 * used across the portal. Centralizes loading/empty states so pages stop
 * re-implementing them (TestRuns, Schedules, Audit Log, Guardian history,
 * API Tokens all share this shape).
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  loadingLabel = 'Loading...',
  emptyIcon,
  emptyTitle = 'No data',
  emptyDescription,
  onRowClick,
}: DataTableProps<T>) {
  if (loading) {
    return <div className="py-12 text-center text-slate-500 text-sm">{loadingLabel}</div>;
  }
  if (rows.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
            {columns.map((col) => (
              <th key={col.key} className={`px-2 py-2 font-medium ${col.className || ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-slate-800/60 last:border-0 ${
                onRowClick ? 'cursor-pointer hover:bg-slate-800/40' : ''
              } transition-colors`}
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-2 py-3 text-slate-300 ${col.className || ''}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
