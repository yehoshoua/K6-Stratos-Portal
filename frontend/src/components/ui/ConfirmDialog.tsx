'use client';

import React from 'react';
import { usePreferences } from '@/components/PreferencesContext';

export interface ConfirmDialogState {
  title: string;
  message: React.ReactNode;
  onConfirm: () => void;
  confirmLabel?: string;
  danger?: boolean;
}

interface ConfirmDialogProps {
  dialog: ConfirmDialogState | null;
  onDismiss: () => void;
}

/**
 * The premium centered confirmation dialog introduced to replace raw
 * `window.confirm()` calls (see WALKTHROUGH.md), now shared as a single
 * component instead of copy-pasted per page.
 */
export default function ConfirmDialog({ dialog, onDismiss }: ConfirmDialogProps) {
  const { t } = usePreferences();
  if (!dialog) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-6 shadow-2xl space-y-4">
        <h3 className="text-lg font-bold text-slate-100">{dialog.title}</h3>
        <div className="text-slate-400 text-xs leading-normal">{dialog.message}</div>
        <div className="flex space-x-3 pt-2">
          <button
            onClick={onDismiss}
            className="flex-1 py-2 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            {t('cancel')}
          </button>
          <button
            onClick={() => {
              dialog.onConfirm();
              onDismiss();
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer text-white ${
              dialog.danger
                ? 'bg-gradient-to-r from-red-600 to-rose-500 hover:from-red-500 hover:to-rose-400'
                : 'bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400'
            }`}
          >
            {dialog.confirmLabel || t('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
