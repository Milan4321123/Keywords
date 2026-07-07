'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FolderTree,
  Waypoints,
  Database,
  MessageSquare,
  FileText,
  Gauge,
  ListChecks,
  Settings,
  ScrollText,
  LogOut,
  ChevronsUpDown,
  Check,
  Plus,
  Menu,
  X,
  HardHat,
} from 'lucide-react';
import { createBrowserSupabase } from '@/lib/supabase/client';

export interface ShellOrg {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface AppShellProps {
  orgs: ShellOrg[];
  activeOrgId: string;
  userEmail: string;
  canManage: boolean;
  /** Simplified on-site worker: minimal navigation. */
  isWorker: boolean;
  children: React.ReactNode;
}

const WORK_ITEM = { href: '/work', label: 'Arbeitsansicht · Work', icon: HardHat };

// Full navigation for editors, managers, and admins
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  WORK_ITEM,
  { href: '/keywords', label: 'Keyword Map', icon: FolderTree },
  { href: '/graph', label: 'Graph View', icon: Waypoints },
  { href: '/data', label: 'Data Hub', icon: Database },
  { href: '/chat', label: 'AI Chat', icon: MessageSquare },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/metrics', label: 'Metrics', icon: Gauge },
  { href: '/tasks', label: 'Tasks', icon: ListChecks },
];

// Stripped-down navigation for on-site workers
const WORKER_NAV_ITEMS = [
  WORK_ITEM,
  { href: '/chat', label: 'AI Chat', icon: MessageSquare },
];

const ADMIN_ITEMS = [
  { href: '/admin', label: 'Admin Settings', icon: Settings },
  { href: '/admin/audit', label: 'Audit Log', icon: ScrollText },
];

export default function AppShell({ orgs, activeOrgId, userEmail, canManage, isWorker, children }: AppShellProps) {
  const navItems = isWorker ? WORKER_NAV_ITEMS : NAV_ITEMS;
  const pathname = usePathname();
  const router = useRouter();
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];

  const switchOrg = async (orgId: string) => {
    setOrgMenuOpen(false);
    if (orgId === activeOrgId) return;
    await fetch('/api/orgs/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: orgId }),
    });
    router.refresh();
    window.location.href = '/dashboard';
  };

  const signOut = async () => {
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);

  const sidebar = (
    <div className="flex flex-col h-full">
      {/* Org switcher */}
      <div className="p-4 border-b border-slate-200 relative">
        <button
          onClick={() => setOrgMenuOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300 transition-all"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
              {activeOrg?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 text-left">
              <div className="text-sm font-semibold text-slate-800 truncate">{activeOrg?.name}</div>
              <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{activeOrg?.role}</div>
            </div>
          </div>
          <ChevronsUpDown className="w-4 h-4 text-slate-400 shrink-0" />
        </button>

        {orgMenuOpen && (
          <div className="absolute left-4 right-4 top-full mt-1 z-50 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden">
            {orgs.map((org) => (
              <button
                key={org.id}
                onClick={() => switchOrg(org.id)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <span className="truncate">{org.name}</span>
                {org.id === activeOrgId && <Check className="w-4 h-4 text-blue-500 shrink-0" />}
              </button>
            ))}
            <Link
              href="/onboarding"
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-50 border-t border-slate-100 transition-colors"
              onClick={() => setOrgMenuOpen(false)}
            >
              <Plus className="w-4 h-4" /> New organization
            </Link>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              isActive(item.href)
                ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/60'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {item.label}
          </Link>
        ))}

        {!isWorker && canManage && (
          <>
            <div className="pt-4 pb-1 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Administration
            </div>
            {ADMIN_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive(item.href)
                    ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/60'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            ))}
          </>
        )}
      </nav>

      {/* User */}
      <div className="p-3 border-t border-slate-200">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="text-xs text-slate-500 truncate" title={userEmail}>
            {userEmail}
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#fafafa] text-slate-900">
      {/* Mobile header */}
      <div className="lg:hidden sticky top-0 z-40 flex items-center justify-between px-4 h-14 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Database className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-bold text-slate-800">Company Brain</span>
        </div>
        <button onClick={() => setMobileOpen((v) => !v)} className="p-2 rounded-lg hover:bg-slate-100">
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 pt-14">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-14 bottom-0 w-72 bg-white border-r border-slate-200 shadow-xl">
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex flex-col w-64 shrink-0 h-screen sticky top-0 bg-white border-r border-slate-200">
          <div className="flex items-center gap-2.5 px-4 h-16 border-b border-slate-200">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20">
              <Database className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 tracking-tight leading-none">Company Brain</div>
              <div className="text-[10px] text-slate-400 font-medium mt-0.5">Organizational AI</div>
            </div>
          </div>
          {sidebar}
        </aside>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
