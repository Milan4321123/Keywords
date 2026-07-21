import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, ArrowRight, Briefcase, Database, ListChecks, Plus } from 'lucide-react';
import { getOrgContextForPage, isWorkerRole } from '@/lib/auth';
import { isProjectKeyword } from '@/lib/projects';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const ctx = await getOrgContextForPage();
  if (!ctx) redirect('/login');
  if (isWorkerRole(ctx.role)) redirect('/work');
  const { supabase, org } = ctx;

  const [keywordsResult, tasksResult, datasetsResult] = await Promise.all([
    supabase
      .from('keywords')
      .select('id,title,slug,parent_id,keyword_type,labels_json,definition,status,updated_at')
      .eq('organization_id', org.id)
      .neq('status', 'archived')
      .order('updated_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('id,keyword_id,status')
      .eq('organization_id', org.id)
      .limit(1000),
    supabase
      .from('datasets')
      .select('id,keyword_id,tables:dataset_tables(id,row_count)')
      .eq('organization_id', org.id),
  ]);
  const keywords = keywordsResult.data ?? [];
  const projects = keywords.filter((keyword: any) => isProjectKeyword(keyword));
  const tasks = tasksResult.data ?? [];
  const datasets = datasetsResult.data ?? [];

  const cards = projects.map((project: any) => {
    const childIds = keywords.filter((keyword: any) => keyword.parent_id === project.id).map((keyword: any) => keyword.id);
    const scope = new Set([project.id, ...childIds]);
    const projectTasks = tasks.filter((task: any) => task.keyword_id && scope.has(task.keyword_id));
    const projectDatasets = datasets.filter((dataset: any) => dataset.keyword_id && scope.has(dataset.keyword_id));
    return {
      ...project,
      openTasks: projectTasks.filter((task: any) => !['done', 'cancelled'].includes(task.status)).length,
      blockedTasks: projectTasks.filter((task: any) => task.status === 'blocked').length,
      tables: projectDatasets.reduce((count: number, dataset: any) => count + (dataset.tables?.length ?? 0), 0),
      rows: projectDatasets.reduce(
        (count: number, dataset: any) => count + (dataset.tables ?? []).reduce((sum: number, table: any) => sum + (table.row_count ?? 0), 0),
        0
      ),
    };
  });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-indigo-500" /> Projects
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            One grounded view of delivery, cost, risks, decisions, tasks, and evidence.
          </p>
        </div>
        <Link
          href="/keywords"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-700 hover:border-indigo-300"
        >
          <Plus className="w-4 h-4" /> Define project
        </Link>
      </div>

      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm text-indigo-900">
        Projects appear here when their root keyword has <span className="font-mono text-xs bg-white/80 px-1.5 py-0.5 rounded">is_project: true</span> or <span className="font-mono text-xs bg-white/80 px-1.5 py-0.5 rounded">object_type: project</span>. Their child keywords, tables, tasks, and metrics form the project context.
      </div>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <Briefcase className="w-9 h-9 text-slate-300 mx-auto" />
          <h2 className="font-semibold text-slate-800 mt-3">No project object defined yet</h2>
          <p className="text-sm text-slate-500 mt-1">Create a top-level project keyword and connect its scope, risks, decisions, and data.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {cards.map((project: any) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group rounded-2xl border border-slate-200 bg-white p-5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/5 transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Project cockpit</div>
                  <h2 className="text-lg font-bold text-slate-900 mt-1 truncate">{project.title}</h2>
                  <p className="text-sm text-slate-500 mt-1 line-clamp-2">{project.definition || 'No approved project definition yet.'}</p>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 shrink-0 mt-1" />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-5">
                <div className="rounded-xl bg-slate-50 p-3">
                  <ListChecks className="w-3.5 h-3.5 text-slate-400" />
                  <div className="text-xl font-bold text-slate-900 mt-1">{project.openTasks}</div>
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Open tasks</div>
                </div>
                <div className={`rounded-xl p-3 ${project.blockedTasks ? 'bg-red-50' : 'bg-slate-50'}`}>
                  <AlertTriangle className={`w-3.5 h-3.5 ${project.blockedTasks ? 'text-red-500' : 'text-slate-400'}`} />
                  <div className="text-xl font-bold text-slate-900 mt-1">{project.blockedTasks}</div>
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Blocked</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <Database className="w-3.5 h-3.5 text-slate-400" />
                  <div className="text-xl font-bold text-slate-900 mt-1">{project.rows}</div>
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Data rows</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
