'use client';

import React, { useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesContext';

export interface LocalContext {
  context_name: string;
  cluster_name: string;
  api_server_url: string;
  is_current: boolean;
}

export function localClusterName(context: LocalContext) {
  return (context.cluster_name || context.context_name).split('/').pop() || context.context_name;
}

export function sortLocalContexts(contexts: LocalContext[]) {
  return [...contexts].sort((a, b) =>
    localClusterName(a).localeCompare(localClusterName(b), undefined, { sensitivity: 'base', numeric: true }) ||
    a.context_name.localeCompare(b.context_name)
  );
}

export default function LocalContextPicker({ contexts, value, onChange, required }: {
  contexts: LocalContext[];
  value: string;
  onChange: (context: LocalContext | null) => void;
  required: boolean;
}) {
  const { t } = usePreferences();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = contexts.find(context => context.context_name === value);
  const search = (query || '').trim().toLocaleLowerCase();
  const matches = sortLocalContexts(contexts).filter(context =>
    [localClusterName(context), context.cluster_name, context.context_name].some(name => name.toLocaleLowerCase().includes(search))
  );

  const select = (context: LocalContext) => {
    onChange(context);
    setQuery(null);
    setOpen(false);
    input.current?.setCustomValidity('');
  };

  return (
    <div className="relative">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-400 mb-1.5">{t('localKubeconfigContext')}</label>
      <div className="relative">
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-activedescendant={open && matches[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
          autoComplete="off"
          required={required}
          placeholder={t('localContextSearch')}
          value={query ?? (selected ? localClusterName(selected) : '')}
          onFocus={event => { setOpen(true); setActiveIndex(0); event.currentTarget.select(); }}
          onBlur={() => { setOpen(false); if (query === '' && selected) setQuery(null); }}
          onChange={event => {
            const text = event.target.value;
            setQuery(text);
            setActiveIndex(0);
            setOpen(true);
            const exact = contexts.filter(context => context.context_name === text || localClusterName(context).toLocaleLowerCase() === text.trim().toLocaleLowerCase());
            const match = exact.length === 1 ? exact[0] : null;
            onChange(match);
            event.currentTarget.setCustomValidity(match || !text ? '' : t('localContextSelectMatch'));
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              const index = !open ? 0 : Math.max(0, Math.min(matches.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)));
              setActiveIndex(index);
              document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: 'nearest' });
            } else if (event.key === 'Enter' && open) {
              event.preventDefault();
              if (matches[activeIndex]) select(matches[activeIndex]);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl ps-3 pe-10 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('localKubeconfigContext')}
          onMouseDown={event => event.preventDefault()}
          onClick={() => { if (open) setOpen(false); else { input.current?.focus(); setQuery(null); setOpen(true); setActiveIndex(0); } }}
          className="absolute end-3 top-3 text-slate-400"
        ><ChevronDown className="w-4 h-4" /></button>
      </div>
      {selected && <p className="mt-1 text-[10px] text-slate-500 break-all">{selected.context_name}</p>}
      {open && (
        <div id={`${id}-options`} role="listbox" aria-label={t('localKubeconfigContext')} className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 shadow-xl">
          {matches.length === 0 ? <p role="status" className="px-3 py-3 text-xs text-slate-400">{t('localContextNoMatches')}</p> : matches.map((context, index) => (
            <button
              key={context.context_name}
              id={`${id}-option-${index}`}
              type="button"
              role="option"
              aria-selected={context.context_name === value}
              tabIndex={-1}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(context)}
              className={`block w-full px-3 py-2 text-start ${index === activeIndex ? 'bg-purple-500/15' : 'hover:bg-slate-800'}`}
            >
              <span className="block text-sm text-slate-200">{localClusterName(context)}{context.is_current ? ` (${t('active')})` : ''}</span>
              <span className="block text-[10px] text-slate-500 break-all">{context.context_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
