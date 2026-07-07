import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  FolderTree,
  Paperclip,
  Table2,
  Users,
  AlertTriangle,
  Activity,
  ArrowRight,
} from 'lucide-react';
import { getOrgContextForPage, isWorkerRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const ctx = await getOrgContextForPage();
  if (!ctx) redirect('/login');

  // On-site workers get the simplified Work view instead of the analytics dashboard
  if (isWorkerRole(ctx.role)) redirect('/work');

  const { supabase, org } = ctx;

  const [keywordsRes, undefinedRes, assetsRes, datasetsRes, membersRes, activityRes, qualityRes] =
    await Promise.all([
      supabase
        .from('keywords')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', org.id),
      supabase
        .from('keywords')
        .select('id, title, slug', { count: 'exact' })
        .eq('organization_id', org.id)
        .or('definition.is.null,definition.eq.')
        .limit(6),
      supabase
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', org.id),
      supabase
        .from('datasets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', org.id),
      supabase
        .from('organization_members')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', org.id),
      supabase
        .from('audit_logs')
        .select('id, action, entity_type, created_at, profiles:actor_id(email, full_name)')
        .eq('organization_id', org.id)
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('data_quality_issues')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', org.id)
        .eq('status', 'open'),
    ]);

  const openQualityIssues = qualityRes.count ?? 0;

  const stats = [
    { label: 'Keywords', value: keywordsRes.count ?? 0, icon: FolderTree, href: '/keywords' },
    { label: 'Assets', value: assetsRes.count ?? 0, icon: Paperclip, href: '/keywords' },
    { label: 'Datasets', value: datasetsRes.count ?? 0, icon: Table2, href: '/data' },
    { label: 'Members', value: membersRes.count ?? 0, icon: Users, href: '/admin' },
  ];

  const undefinedKeywords = undefinedRes.data ?? [];
  const undefinedCount = undefinedRes.count ?? 0;
  const activity = (activityRes.data ?? []) as unknown as Array<{
    id: string;
    action: string;
    entity_type: string | null;
    created_at: string;
    profiles: { email: string; full_name: string | null } | null;
  }>;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{org.name}</h1>
        <p className="text-sm text-slate-500 mt-1">
          Company intelligence overview — keywords, evidence, data, and activity.
        </p>
      </div>

      {openQualityIssues > 0 && (
        <Link
          href="/data"
          className="flex items-center gap-3 px-5 py-4 rounded-2xl bg-amber-50 border border-amber-200 hover:border-amber-300 transition-colors"
        >
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <span className="text-sm text-amber-800">
            <span className="font-semibold">{openQualityIssues} open data quality issue{openQualityIssues > 1 ? 's' : ''}</span>
            {' '}— review them in the Data Hub before relying on analytics.
          </span>
        </Link>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="group bg-white rounded-2xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-lg hover:shadow-blue-500/5 transition-all"
          >
            <div className="flex items-center justify-between">
              <stat.icon className="w-5 h-5 text-slate-400 group-hover:text-blue-500 transition-colors" />
              <ArrowRight className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="mt-3 text-3xl font-bold text-slate-900">{stat.value}</div>
            <div className="text-xs font-medium text-slate-500 mt-1">{stat.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Missing definitions */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Missing definitions
            </h2>
            <span className="text-xs font-medium text-slate-400">{undefinedCount} total</span>
          </div>
          {undefinedKeywords.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              Every keyword has a definition. Well organized.
            </p>
          ) : (
            <div className="space-y-2">
              {undefinedKeywords.map((kw) => (
                <Link
                  key={kw.id}
                  href="/keywords"
                  className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-amber-50/60 border border-amber-100 hover:border-amber-300 transition-colors"
                >
                  <span className="text-sm font-medium text-slate-700">{kw.title}</span>
                  <span className="text-xs text-amber-600 font-medium">define →</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-blue-500" />
            Recent activity
          </h2>
          {activity.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              No activity yet. Actions across the workspace appear here.
            </p>
          ) : (
            <div className="space-y-1.5">
              {activity.map((event) => (
                <div key={event.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-50">
                  <div className="min-w-0">
                    <span className="text-sm text-slate-700 font-medium">{event.action}</span>
                    <span className="text-xs text-slate-400 ml-2">
                      {event.profiles?.full_name || event.profiles?.email || 'system'}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0 ml-3">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
