'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { CustomPalette } from '@/components/PreferencesContext';

interface PaletteEditorModalProps {
  open: boolean;
  editingPalette: CustomPalette | null;
  duplicateMode?: boolean;
  onClose: () => void;
  onSave: (palette: CustomPalette) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

type PaletteForm = {
  name: string;
  primary: string;
  primaryHover: string;
  primaryLight: string;
  primaryLightest: string;
  primaryDark: string;
  accent: string;
  accentHover: string;
  accentLight: string;
  accentLightest: string;
  accentDark: string;
  backgroundDark: string;
  backgroundLight: string;
};

const defaultForm: PaletteForm = {
  name: '',
  primary: '#a855f7',
  primaryHover: '#9333ea',
  primaryLight: '#c084fc',
  primaryLightest: '#e9d5ff',
  primaryDark: '#581c87',
  accent: '#ec4899',
  accentHover: '#db2777',
  accentLight: '#f472b6',
  accentLightest: '#fbcfe8',
  accentDark: '#831843',
  backgroundDark: '#090d16',
  backgroundLight: '#f1f5f9',
};

function adjustColor(hex: string, percent: number): string {
  try {
    let color = hex.replace(/^\s*#|\s*$/g, '');
    if (color.length === 3) color = color.replace(/(.)/g, '$1$1');
    if (color.length !== 6) return hex;
    let r = parseInt(color.substring(0, 2), 16);
    let g = parseInt(color.substring(2, 4), 16);
    let b = parseInt(color.substring(4, 6), 16);
    r = Math.min(255, Math.max(0, Math.round(r * (1 + percent / 100))));
    g = Math.min(255, Math.max(0, Math.round(g * (1 + percent / 100))));
    b = Math.min(255, Math.max(0, Math.round(b * (1 + percent / 100))));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  } catch {
    return hex;
  }
}

function paletteToForm(palette: CustomPalette): PaletteForm {
  return {
    name: palette.name,
    primary: palette.colors.primary,
    primaryHover: palette.colors.primaryHover,
    primaryLight: palette.colors.primaryLight,
    primaryLightest: palette.colors.primaryLightest,
    primaryDark: palette.colors.primaryDark,
    accent: palette.colors.accent,
    accentHover: palette.colors.accentHover,
    accentLight: palette.colors.accentLight,
    accentLightest: palette.colors.accentLightest,
    accentDark: palette.colors.accentDark,
    backgroundDark: palette.colors.backgroundDark || '#090d16',
    backgroundLight: palette.colors.backgroundLight || '#f1f5f9',
  };
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg border border-slate-800 bg-slate-950 cursor-pointer shrink-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-purple-500/60"
        />
      </div>
    </div>
  );
}

export default function PaletteEditorModal({
  open,
  editingPalette,
  duplicateMode = false,
  onClose,
  onSave,
  t,
}: PaletteEditorModalProps) {
  const [form, setForm] = useState<PaletteForm>(defaultForm);
  const [initialForm, setInitialForm] = useState<PaletteForm>(defaultForm);

  useEffect(() => {
    if (!open) return;
    if (editingPalette) {
      const next = paletteToForm(editingPalette);
      setForm(next);
      setInitialForm(next);
    } else {
      setForm(defaultForm);
      setInitialForm(defaultForm);
    }
  }, [open, editingPalette]);

  if (!open) return null;

  const handlePrimaryChange = (val: string) => {
    const isValid = /^#[0-9A-Fa-f]{6}$/.test(val) || /^#[0-9A-Fa-f]{3}$/.test(val);
    if (isValid) {
      setForm((prev) => ({
        ...prev,
        primary: val,
        primaryHover: adjustColor(val, -12),
        primaryLight: adjustColor(val, 15),
        primaryLightest: adjustColor(val, 40),
        primaryDark: adjustColor(val, -45),
      }));
    } else {
      setForm((prev) => ({ ...prev, primary: val }));
    }
  };

  const handleAccentChange = (val: string) => {
    const isValid = /^#[0-9A-Fa-f]{6}$/.test(val) || /^#[0-9A-Fa-f]{3}$/.test(val);
    if (isValid) {
      setForm((prev) => ({
        ...prev,
        accent: val,
        accentHover: adjustColor(val, -12),
        accentLight: adjustColor(val, 15),
        accentLightest: adjustColor(val, 40),
        accentDark: adjustColor(val, -45),
      }));
    } else {
      setForm((prev) => ({ ...prev, accent: val }));
    }
  };

  const handleResetColors = () => {
    setForm(initialForm);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const id = duplicateMode || !editingPalette ? `custom-${Date.now()}` : editingPalette.id;
    onSave({
      id,
      name: form.name.trim(),
      colors: {
        primary: form.primary,
        primaryHover: form.primaryHover,
        primaryLight: form.primaryLight,
        primaryLightest: form.primaryLightest,
        primaryDark: form.primaryDark,
        accent: form.accent,
        accentHover: form.accentHover,
        accentLight: form.accentLight,
        accentLightest: form.accentLightest,
        accentDark: form.accentDark,
        backgroundDark: form.backgroundDark,
        backgroundLight: form.backgroundLight,
      },
    });
  };

  const isEditing = Boolean(editingPalette) && !duplicateMode;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl p-8 shadow-2xl relative max-h-[90vh] flex flex-col">
        <button type="button" onClick={onClose} className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer">
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-2xl font-bold text-white mb-2">
          {duplicateMode ? t('duplicatePaletteTitle') : isEditing ? t('editCustomPalette') : t('customPaletteTitle')}
        </h3>
        <p className="text-slate-400 text-xs mb-6">
          {duplicateMode ? t('duplicatePaletteDesc') : t('createPaletteDesc')}
        </p>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto pr-2 space-y-6">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('paletteName')}</label>
            <input
              type="text"
              required
              placeholder="e.g. Sunset Neon"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-purple-500/60"
            />
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">{t('backgroundColors') || 'Background'}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ColorField label={t('backgroundDark')} value={form.backgroundDark} onChange={(v) => setForm({ ...form, backgroundDark: v })} />
              <ColorField label={t('backgroundLight')} value={form.backgroundLight} onChange={(v) => setForm({ ...form, backgroundLight: v })} />
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">{t('primaryColors')}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ColorField label={t('basePrimary')} value={form.primary} onChange={handlePrimaryChange} />
              <ColorField label={t('primaryHover')} value={form.primaryHover} onChange={(v) => setForm({ ...form, primaryHover: v })} />
              <ColorField label={t('primaryLight')} value={form.primaryLight} onChange={(v) => setForm({ ...form, primaryLight: v })} />
              <ColorField label={t('primaryLightest')} value={form.primaryLightest} onChange={(v) => setForm({ ...form, primaryLightest: v })} />
              <ColorField label={t('primaryDark')} value={form.primaryDark} onChange={(v) => setForm({ ...form, primaryDark: v })} />
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">{t('accentColor')}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ColorField label={t('accentColor')} value={form.accent} onChange={handleAccentChange} />
              <ColorField label={t('accentHover')} value={form.accentHover} onChange={(v) => setForm({ ...form, accentHover: v })} />
              <ColorField label={t('accentLight')} value={form.accentLight} onChange={(v) => setForm({ ...form, accentLight: v })} />
              <ColorField label={t('accentLightest')} value={form.accentLightest} onChange={(v) => setForm({ ...form, accentLightest: v })} />
              <ColorField label={t('accentDark')} value={form.accentDark} onChange={(v) => setForm({ ...form, accentDark: v })} />
            </div>
          </div>

          <div className="flex space-x-3 pt-6 border-t border-slate-800/80">
            <button type="button" onClick={onClose} className="flex-1 py-3 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer">
              {t('cancel')}
            </button>
            {(isEditing || duplicateMode) && (
              <button type="button" onClick={handleResetColors} className="flex-1 py-3 border border-slate-850 hover:bg-slate-800 hover:text-white text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer">
                {t('reset')}
              </button>
            )}
            <button type="submit" className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer">
              {isEditing ? t('saveChanges') : t('createPalette')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
