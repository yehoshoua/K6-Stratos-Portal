'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, LayoutDashboard, Activity, BarChart3, HardDrive, Settings, CornerDownLeft } from 'lucide-react';
import { usePreferences } from './PreferencesContext';
import { getK6WorkspaceCopy } from '@/i18n/k6Workspace';

interface PaletteItem {
  id: string;
  labelKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  literalLabel?: string;
}

const BASE_ITEMS: PaletteItem[] = [
  { id: 'dashboard', labelKey: 'dashboard', href: '/', icon: LayoutDashboard },
  { id: 'clusters', labelKey: 'k8sClusters', href: '/clusters', icon: HardDrive },
  { id: 'metrics', labelKey: 'influxdb', href: '/metrics', icon: BarChart3 },
  { id: 'settings', labelKey: 'settings', href: '/settings', icon: Settings, adminOnly: true },
];

/**
 * Global Cmd/Ctrl+K command palette for fast navigation across the
 * portal — standard in serious internal operations platforms. Mounted
 * once in LayoutWrapper so it is available from every authenticated page.
 */
export default function CommandPalette() {
  const router = useRouter();
  const { t, lang } = usePreferences();
  const k6Copy = getK6WorkspaceCopy(lang);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const isAdmin = typeof window !== 'undefined' && localStorage.getItem('role') === 'administrator';

  const items = useMemo(() => {
    const source: PaletteItem[] = [BASE_ITEMS[0], { id: 'tests', labelKey: 'crdControl', literalLabel: k6Copy.title, href: '/tests', icon: Activity }, ...BASE_ITEMS.slice(1)];
    const visible = source.filter((item) => !item.adminOnly || isAdmin).map((item) => ({ ...item, label: item.literalLabel || t(item.labelKey) }));
    if (!query.trim()) return visible;
    const q = query.trim().toLowerCase();
    return visible.filter((item) => item.label.toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, isAdmin, lang, k6Copy.title, t]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuery('');
        setActiveIndex(0);
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && items[activeIndex]) {
      e.preventDefault();
      navigate(items[activeIndex].href);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[100] flex items-start justify-center pt-[15vh] p-4 animate-fadeIn" onClick={() => setOpen(false)}>
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          <Search className="w-4 h-4 text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPaletteHint')}
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none"
          />
          <kbd className="text-[10px] text-slate-600 border border-slate-800 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">{t('commandPaletteNoResults')}</div>
          ) : (
            <>
              <div className="px-4 pb-1 pt-1 text-[10px] uppercase tracking-wider text-slate-600 font-semibold">
                {t('commandPaletteNavigation')}
              </div>
              {items.map((item, idx) => {
                const Icon = item.icon;
                const active = idx === activeIndex;
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.href)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition cursor-pointer ${
                      active ? 'bg-purple-500/10 text-white' : 'text-slate-300 hover:bg-slate-800/60'
                    }`}
                  >
                    <Icon className="w-4 h-4 text-slate-400" />
                    <span className="flex-1">{item.label}</span>
                    {active && <CornerDownLeft className="w-3.5 h-3.5 text-slate-500" />}
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
