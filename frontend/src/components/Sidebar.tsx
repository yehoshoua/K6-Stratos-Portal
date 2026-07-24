'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  Activity,
  BarChart3, 
  LogOut, 
  User, 
  HardDrive,
  Settings,
  Sun,
  Moon,
  Monitor,
  Globe,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { api } from '@/services/api';
import { usePreferences, Language, Theme } from './PreferencesContext';
import { getK6WorkspaceCopy } from '@/i18n/k6Workspace';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { lang, theme, setLang, setTheme, t } = usePreferences();
  const k6Copy = getK6WorkspaceCopy(lang);
  
  const [username, setUsername] = React.useState('Admin');
  const [role, setRole] = React.useState('administrator');
  const [collapsed, setCollapsed] = React.useState(false);

  interface Workspace {
    id: string;
    name: string;
  }
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState('default');

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedUser = localStorage.getItem('username');
      const storedRole = localStorage.getItem('role');
      if (storedUser) setUsername(storedUser);
      if (storedRole) setRole(storedRole);
      const storedCollapsed = localStorage.getItem('sidebarCollapsed');
      if (storedCollapsed !== null) {
        setCollapsed(storedCollapsed === 'true');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    const fetchWorkspaces = async () => {
      try {
        const stored = localStorage.getItem('active_workspace_id');
        if (stored) {
          setActiveWorkspaceId(stored);
        } else {
          localStorage.setItem('active_workspace_id', 'default');
        }

        const list = await api.getWorkspaces();
        if (list && list.length > 0) {
          setWorkspaces(list);
          if (stored && !list.some((w: any) => w.id === stored)) {
            setActiveWorkspaceId(list[0].id);
            localStorage.setItem('active_workspace_id', list[0].id);
          }
        } else {
          setWorkspaces([{ id: 'default', name: 'Default Workspace' }]);
        }
      } catch (err) {
        console.error('Failed to load workspaces', err);
        setWorkspaces([{ id: 'default', name: 'Default Workspace' }]);
      }
    };
    fetchWorkspaces();
  }, []);

  const menuItems = [
    { name: t('dashboard'), href: '/', icon: LayoutDashboard },
    { name: k6Copy.title, href: '/tests', icon: Activity },
    { name: t('k8sClusters'), href: '/clusters', icon: HardDrive },
    { name: t('influxdb'), href: '/metrics', icon: BarChart3 },
  ];

  // Dynamically append Settings for all authenticated users
  if (role) {
    menuItems.push({ name: t('settings'), href: '/settings', icon: Settings });
  }

  const handleLogout = () => {
    api.logout();
    router.push('/login');
  };

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('sidebarCollapsed', String(next));
      }
      return next;
    });
  };

  return (
    <aside className={`${collapsed ? 'w-20' : 'w-64'} bg-slate-900 border-r border-slate-800 text-slate-200 flex flex-col justify-between h-screen sticky top-0 transition-all duration-300`}>
      {/* Brand Header */}
      <div>
        <div className={`p-6 flex items-center border-b border-slate-800/80 ${collapsed ? 'flex-col gap-3' : 'justify-between'}`}>
          <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'space-x-3'}`}>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center font-bold text-white shadow-lg shadow-purple-500/20">
              K6
            </div>
            {!collapsed && (
              <div>
                <h1 className="font-bold text-lg bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  K6 Stratos
                </h1>
                <span className="text-[10px] text-purple-400 font-semibold tracking-wider uppercase">
                  {t('activeAgent')}
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={toggleCollapse}
            title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
            className="p-2 rounded-xl border border-slate-800 text-slate-400 hover:text-slate-100 hover:border-purple-500/30 hover:bg-slate-800/60 transition cursor-pointer"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Workspace Context Selector */}
        {!collapsed && (
          <div className="px-6 py-3 border-b border-slate-800/80 bg-slate-950/20">
            <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Workspace
            </label>
            <div className="relative">
              <select
                value={activeWorkspaceId}
                onChange={(e) => {
                  const wsId = e.target.value;
                  setActiveWorkspaceId(wsId);
                  localStorage.setItem('active_workspace_id', wsId);
                  window.location.reload();
                }}
                className="w-full bg-slate-950/80 border border-slate-850 hover:border-slate-800 text-xs text-slate-305 px-3 py-2 rounded-xl outline-none focus:border-purple-500/50 transition cursor-pointer font-medium"
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Navigation Menu */}
        <nav className={`p-4 space-y-1 ${collapsed ? 'items-center' : ''}`}>
          {menuItems.map((item) => {
            const isActive = pathname === item.href || (item.href === '/tests' && (pathname === '/crds' || pathname === '/schedules'));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.name : undefined}
                className={`flex items-center ${collapsed ? 'justify-center px-3' : 'space-x-3 px-4'} py-3 rounded-xl transition-all duration-300 group ${
                  isActive
                    ? 'bg-gradient-to-r from-purple-900/50 to-pink-900/10 text-white border border-purple-500/30 shadow-md shadow-purple-500/5'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                <Icon className={`w-5 h-5 transition-transform duration-300 group-hover:scale-105 ${isActive ? 'text-purple-400' : 'text-slate-400 group-hover:text-slate-200'}`} />
                <span className={`text-sm font-medium ${collapsed ? 'hidden' : ''}`}>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Preferences, User Session & Logout */}
      {collapsed ? (
        <div className="p-4 border-t border-slate-800/80 flex flex-col items-center">
          <button
            onClick={handleLogout}
            title={t('logout')}
            className="p-2 rounded-xl border border-slate-800 text-slate-400 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="p-4 border-t border-slate-800/80 space-y-4">
        
          {/* Language & Theme controls */}
          <div className="space-y-3 p-3 bg-slate-950/40 rounded-2xl border border-slate-800">
            {/* Language selector */}
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-medium">
                <Globe className="w-3.5 h-3.5" />
                <span>{t('lang')}</span>
              </span>
              <div className="relative">
                <select
                  value={lang}
                  onChange={(event) => setLang(event.target.value as Language)}
                  aria-label={t('lang')}
                  className="appearance-none bg-slate-900 border border-slate-800 rounded-lg py-1 pl-2 pr-6 text-[10px] font-bold text-slate-200 cursor-pointer outline-none focus:border-purple-500/60"
                >
                  <option value="en">English</option>
                  <option value="fr">Français</option>
                  <option value="es">Español</option>
                  <option value="de">Deutsch</option>
                  <option value="he">עברית</option>
                  <option value="zh">中文</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 w-3 h-3 -translate-y-1/2 text-slate-500" />
              </div>
            </div>

            {/* Theme selector */}
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-medium">
                <Sun className="w-3.5 h-3.5" />
                <span>{t('theme')}</span>
              </span>
              <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                {[
                  { name: 'light', icon: Sun, label: 'Light' },
                  { name: 'dark', icon: Moon, label: 'Dark' },
                  { name: 'system', icon: Monitor, label: 'System' }
                ].map(th => {
                  const Icon = th.icon;
                  const isSelected = theme === th.name;
                  return (
                    <button
                      key={th.name}
                      onClick={() => setTheme(th.name as Theme)}
                      title={th.label}
                      className={`p-1 rounded transition cursor-pointer ${
                        isSelected ? 'bg-slate-800 text-purple-400 border border-purple-500/20' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* User Card */}
          <div className="flex items-center space-x-3 px-3 py-2 bg-slate-800/40 rounded-xl border border-slate-800">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 border border-slate-600">
              <User className="w-4 h-4" />
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-slate-200 truncate">{username}</p>
              <p className="text-[10px] text-slate-500 capitalize truncate">{role}</p>
            </div>
          </div>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl border border-slate-800 hover:border-red-500/30 hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all duration-300 text-sm font-medium cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t('logout')}</span>
          </button>
        </div>
      )}
    </aside>
  );
}
