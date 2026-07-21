import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  Calculator,
  CalendarClock,
  CircleDollarSign,
  Database,
  FileText,
  ListChecks,
  ShieldAlert,
  Target,
  Users,
} from 'lucide-react';
import { getOrgContextForPage, isWorkerRole } from '@/lib/auth';
import { computeMetric, MetricDefinition, MetricComputation } from '@/lib/metrics/compute';
import { buildProjectAttention, classifyProjectTable, isProjectKeyword } from '@/lib/projects';

export const dynamic = 'force-dynamic';

function currency(value: number | null): string {
  return value == null
    ? '—'
    : new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

function number(value: number | null, suffix = ''): string {
  return value == null ? '—' : `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })}${suffix}`;
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function statusStyle(value: string): string {
  const status = value.toLowerCase();
  if (['blocked', 'high', 'open', 'concerned'].includes(status)) return 'bg-red-50 text-red-700 border-red-200';
  if (['done', 'approved', 'closed', 'positive', 'supportive'].includes(status)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (['in_progress', 'mitigating'].includes(status)) return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function metricResult(
  computed: Array<{ definition: MetricDefinition; result: MetricComputation }>,
  pattern: RegExp
) {
  return computed.find((item) => pattern.test(item.definition.name));
}

export default async function ProjectCockpitPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContextForPage();
  if (!ctx) redirect('/login');
  if (isWorkerRole(ctx.role)) redirect('/work');
  const { id } = await params;
  const { supabase, org } = ctx;

  const { data: project } = await supabase
    .from('keywords')
    .select('*')
    .eq('organization_id', org.id)
    .eq('id', id)
    .maybeSingle();
  if (!project || !isProjectKeyword(project)) notFound();

  const { data: allKeywords } = await supabase
    .from('keywords')
    .select('id,title,parent_id,keyword_type')
    .eq('organization_id', org.id)
    .neq('status', 'archived');
  const scopedIds = new Set<string>([project.id]);
  for (let depth = 0; depth < 3; depth++) {
    for (const keyword of allKeywords ?? []) {
      if (keyword.parent_id && scopedIds.has(keyword.parent_id)) scopedIds.add(keyword.id);
    }
  }
  const keywordIds = Array.from(scopedIds);

  const [datasetsResult, tasksResult, metricsResult, assetsResult] = await Promise.all([
    supabase
      .from('datasets')
      .select('id,title,description,keyword_id,tables:dataset_tables(id,name,row_count,column_count)')
      .eq('organization_id', org.id)
      .in('keyword_id', keywordIds),
    supabase
      .from('tasks')
      .select('id,title,description,status,priority,due_date,keyword_id,assignee:organization_members(profiles(full_name,email)),dependencies:task_dependencies!task_dependencies_task_id_fkey(depends_on_task_id)')
      .eq('organization_id', org.id)
      .in('keyword_id', keywordIds)
      .order('due_date', { ascending: true, nullsFirst: false }),
    supabase
      .from('metrics')
      .select('*')
      .eq('organization_id', org.id)
      .in('keyword_id', keywordIds),
    supabase
      .from('keyword_assets')
      .select('keyword_id,note,relevance_score,asset:assets(id,title,file_name,file_type,source,processing_status,created_at,extracted_text)')
      .in('keyword_id', keywordIds)
      .order('relevance_score', { ascending: false }),
  ]);

  const datasets = datasetsResult.data ?? [];
  const tableDescriptors = datasets.flatMap((dataset: any) =>
    (dataset.tables ?? []).map((table: any) => ({ ...table, datasetId: dataset.id, datasetTitle: dataset.title, keywordId: dataset.keyword_id }))
  );
  const tableIds = tableDescriptors.map((table: any) => table.id);
  const { data: rawRows } = tableIds.length
    ? await supabase
        .from('dataset_rows')
        .select('id,dataset_table_id,row_index,data,source_json')
        .in('dataset_table_id', tableIds)
        .order('row_index')
        .limit(1500)
    : { data: [] as any[] };
  const rowsByTable = new Map<string, any[]>();
  for (const row of rawRows ?? []) {
    const values = rowsByTable.get(row.dataset_table_id) ?? [];
    values.push(row);
    rowsByTable.set(row.dataset_table_id, values);
  }
  const tables = tableDescriptors.map((table: any) => ({
    ...table,
    rows: (rowsByTable.get(table.id) ?? []).map((row: any) => row.data as Record<string, unknown>),
    evidenceRows: rowsByTable.get(table.id) ?? [],
    type: classifyProjectTable(table.name),
  }));

  const tasks = (tasksResult.data ?? []).map((task: any) => ({
    ...task,
    is_blocked: task.status === 'blocked' || (task.dependencies ?? []).some((dependency: any) => {
      const source = (tasksResult.data ?? []).find((candidate: any) => candidate.id === dependency.depends_on_task_id);
      return source && !['done', 'cancelled'].includes(source.status);
    }),
  }));
  const openTasks = tasks.filter((task: any) => !['done', 'cancelled'].includes(task.status));
  const computed = (await Promise.all((metricsResult.data ?? []).map(async (definition: any) => {
    try {
      return { definition: definition as MetricDefinition, result: await computeMetric(supabase, org.id, definition, { mode: 'value' }) };
    } catch {
      return null;
    }
  }))).filter(Boolean) as Array<{ definition: MetricDefinition; result: MetricComputation }>;

  const budget = metricResult(computed, /approved budget/i);
  const actual = metricResult(computed, /actual cost/i);
  const forecast = metricResult(computed, /forecast cost/i);
  const progress = metricResult(computed, /average progress/i);
  const riskExposure = metricResult(computed, /open risk exposure/i);
  const openDecisions = metricResult(computed, /open decisions/i);
  const attention = buildProjectAttention(tasks, tables, new Date());
  const controlTable = tables.find((table: any) => table.type === 'control');
  const riskTable = tables.find((table: any) => table.type === 'risk');
  const decisionTable = tables.find((table: any) => table.type === 'decision');
  const stakeholderTable = tables.find((table: any) => table.type === 'stakeholder');
  const assets = (assetsResult.data ?? []).map((link: any) => link.asset).filter(Boolean);
  const forecastOver = budget?.result.value != null && forecast?.result.value != null
    ? forecast.result.value - budget.result.value
    : null;
  const prompt = encodeURIComponent(`Act as the project manager for ${project.title}. Give an evidence-backed executive status: delivery progress, budget variance, blockers, risk exposure, pending decisions, responsible next actions, and missing evidence. Clearly separate verified facts, derived metrics, and recommendations.`);

  const kpis = [
    { label: 'Progress', value: number(progress?.result.value ?? null, '%'), item: progress, icon: Target, alert: false },
    { label: 'Approved budget', value: currency(budget?.result.value ?? null), item: budget, icon: CircleDollarSign, alert: false },
    { label: 'Actual cost', value: currency(actual?.result.value ?? null), item: actual, icon: Calculator, alert: false },
    { label: 'Forecast cost', value: currency(forecast?.result.value ?? null), item: forecast, icon: CircleDollarSign, alert: (forecastOver ?? 0) > 0 },
    { label: 'Open risk exposure', value: currency(riskExposure?.result.value ?? null), item: riskExposure, icon: ShieldAlert, alert: (riskExposure?.result.value ?? 0) > 0 },
    { label: 'Open decisions', value: number(openDecisions?.result.value ?? null), item: openDecisions, icon: CalendarClock, alert: (openDecisions?.result.value ?? 0) > 0 },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
        <div>
          <Link href="/projects" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-indigo-600 mb-3">
            <ArrowLeft className="w-3.5 h-3.5" /> All projects
          </Link>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-indigo-500">
            <BadgeCheck className="w-3.5 h-3.5" /> Grounded project cockpit
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-1">{project.title}</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-3xl">{project.definition || 'Project definition is missing.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/data" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:border-indigo-300">
            <Database className="w-4 h-4" /> Edit source data
          </Link>
          <Link href="/tasks" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:border-indigo-300">
            <ListChecks className="w-4 h-4" /> Manage tasks
          </Link>
          <Link href={`/chat?keyword_id=${project.id}&mode=report&prompt=${prompt}`} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800">
            <BrainCircuit className="w-4 h-4" /> Ask AI project manager
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[11px] text-slate-500">
        <span className="font-bold text-slate-700">Truth legend</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" /> Source fact — editable table row</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Derived fact — registered metric formula</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> Attention rule — requires management review</span>
        <span className="ml-auto">Updated from {tables.length} tables · {rawRows?.length ?? 0} evidence rows · {assets.length} documents</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={`rounded-2xl border p-4 ${kpi.alert ? 'bg-red-50/50 border-red-200' : 'bg-white border-slate-200'}`}>
            <kpi.icon className={`w-4 h-4 ${kpi.alert ? 'text-red-500' : 'text-slate-400'}`} />
            <div className="text-xl font-bold text-slate-900 mt-2 truncate" title={kpi.value}>{kpi.value}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mt-1">{kpi.label}</div>
            <div className="text-[9px] text-emerald-600 mt-2 truncate" title={kpi.item?.definition.formula ?? ''}>
              {kpi.item ? `Derived · ${kpi.item.result.matched_rows} rows` : 'Missing metric definition'}
            </div>
          </div>
        ))}
      </div>

      {forecastOver != null && forecastOver > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <div>
            <div className="font-bold text-red-800">Forecast exceeds approved budget by {currency(forecastOver)}</div>
            <div className="text-xs text-red-700 mt-1">Derived from the registered Approved Budget and Forecast Cost metrics. Review the underlying work packages before changing scope or budget.</div>
          </div>
        </div>
      )}

      <div className="grid xl:grid-cols-[1.2fr_0.8fr] gap-5">
        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
              <h2 className="font-bold text-slate-900 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> Management attention</h2>
              <p className="text-xs text-slate-500 mt-0.5">Deterministic signals from task status, dependencies, risk rows, and decision rows.</p>
            </div>
            <span className="text-xs font-bold text-slate-400">{attention.length} signals</span>
          </div>
          <div className="divide-y divide-slate-100">
            {attention.slice(0, 10).map((item) => (
              <div key={item.id} className="px-5 py-3.5 flex items-start gap-3">
                <span className={`mt-0.5 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase ${item.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{item.kind}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.detail}</div>
                  {(item.owner || item.dueDate) && <div className="text-[10px] text-slate-400 mt-1">{item.owner ? `Owner: ${item.owner}` : ''}{item.owner && item.dueDate ? ' · ' : ''}{item.dueDate ? `Due: ${item.dueDate}` : ''}</div>}
                </div>
              </div>
            ))}
            {attention.length === 0 && <div className="px-5 py-10 text-sm text-slate-400 text-center">No management-attention rule is currently triggered.</div>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
              <h2 className="font-bold text-slate-900 flex items-center gap-2"><ListChecks className="w-4 h-4 text-blue-500" /> Next work</h2>
              <p className="text-xs text-slate-500 mt-0.5">Open, owned, and deadline-aware.</p>
            </div>
            <Link href="/tasks" className="text-xs font-semibold text-indigo-600">Open board →</Link>
          </div>
          <div className="divide-y divide-slate-100">
            {openTasks.slice(0, 8).map((task: any) => (
              <div key={task.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-800">{task.title}</div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-md border text-[9px] font-bold uppercase ${statusStyle(task.status)}`}>{task.status.replace('_', ' ')}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {task.assignee?.profiles?.full_name || task.assignee?.profiles?.email || 'No owner'}
                  {task.due_date ? ` · due ${task.due_date}` : ' · no due date'} · {task.priority}
                </div>
              </div>
            ))}
            {openTasks.length === 0 && <div className="px-5 py-10 text-sm text-slate-400 text-center">No open project tasks.</div>}
          </div>
        </section>
      </div>

      {controlTable && (
        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
              <h2 className="font-bold text-slate-900 flex items-center gap-2"><Target className="w-4 h-4 text-indigo-500" /> Delivery plan</h2>
              <p className="text-xs text-slate-500 mt-0.5">Source fact · {controlTable.datasetTitle} / {controlTable.name} · {controlTable.row_count} rows</p>
            </div>
            <Link href="/data" className="text-xs font-semibold text-indigo-600">Edit rows →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3">Work package</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3 min-w-[180px]">Progress</th><th className="px-4 py-3">Forecast / budget</th><th className="px-4 py-3">Next action</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {controlTable.rows.map((row: any, index: number) => {
                  const progressValue = Math.max(0, Math.min(100, Number(row.progress_pct) || 0));
                  return <tr key={text(row.work_package_id) || index} className="text-xs align-top">
                    <td className="px-5 py-3"><div className="font-bold text-slate-800">{text(row.work_package_id)}</div><div className="text-slate-500 mt-0.5 max-w-[220px]">{text(row.deliverable)}</div></td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{text(row.owner)}</td>
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="h-2 rounded-full bg-slate-100 flex-1 overflow-hidden"><div className={`h-full rounded-full ${text(row.status) === 'blocked' ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${progressValue}%` }} /></div><span className="font-mono font-bold text-slate-700">{progressValue}%</span></div><div className="text-[10px] text-slate-400 mt-1">{text(row.status).replace('_', ' ')} · end {text(row.planned_end)}</div></td>
                    <td className="px-4 py-3 whitespace-nowrap"><div className={Number(row.forecast_cost_eur) > Number(row.budget_eur) ? 'font-bold text-red-600' : 'text-slate-700'}>{currency(Number(row.forecast_cost_eur))}</div><div className="text-[10px] text-slate-400">of {currency(Number(row.budget_eur))}</div></td>
                    <td className="px-4 py-3 text-slate-600 min-w-[220px]">{text(row.next_action)}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid xl:grid-cols-2 gap-5">
        {riskTable && <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-900 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-red-500" /> Risk register</h2><p className="text-xs text-slate-500 mt-0.5">Source facts · {riskTable.row_count} rows</p></div>
          <div className="divide-y divide-slate-100">{riskTable.rows.slice(0, 8).map((row: any, index: number) => <div key={text(row.risk_id) || index} className="px-5 py-3"><div className="flex items-start justify-between gap-3"><div className="text-sm font-semibold text-slate-800">{text(row.title)}</div><span className={`px-2 py-0.5 rounded-md border text-[9px] font-bold uppercase ${statusStyle(text(row.status))}`}>{text(row.status)}</span></div><div className="flex items-center justify-between gap-3 mt-1 text-[10px] text-slate-400"><span>{text(row.owner)} · due {text(row.due_date)}</span><span className="font-bold text-red-600">{currency(Number(row.exposure_eur))} exposure</span></div></div>)}</div>
        </section>}
        {decisionTable && <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-900 flex items-center gap-2"><BadgeCheck className="w-4 h-4 text-emerald-500" /> Decision log</h2><p className="text-xs text-slate-500 mt-0.5">Approved and pending project memory · {decisionTable.row_count} rows</p></div>
          <div className="divide-y divide-slate-100">{decisionTable.rows.slice(0, 8).map((row: any, index: number) => <div key={text(row.decision_id) || index} className="px-5 py-3"><div className="flex items-start justify-between gap-3"><div className="text-sm font-semibold text-slate-800">{text(row.title)}</div><span className={`px-2 py-0.5 rounded-md border text-[9px] font-bold uppercase ${statusStyle(text(row.status))}`}>{text(row.status)}</span></div><div className="text-xs text-slate-500 mt-1 line-clamp-2">{text(row.decision)}</div><div className="text-[10px] text-slate-400 mt-1">Owner: {text(row.owner)} · review {text(row.review_date)}</div></div>)}</div>
        </section>}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><Users className="w-4 h-4 text-blue-500" /> Stakeholders</h2>
          <div className="mt-3 space-y-3">{(stakeholderTable?.rows ?? []).slice(0, 6).map((row: any, index: number) => <div key={index}><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-700">{text(row.stakeholder)}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${statusStyle(text(row.sentiment))}`}>{text(row.sentiment)}</span></div><p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{text(row.summary)}</p></div>)}{!stakeholderTable && <p className="text-xs text-slate-400 mt-3">No stakeholder table linked.</p>}</div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-500" /> Evidence</h2>
          <div className="mt-3 space-y-3">{assets.slice(0, 6).map((asset: any) => <div key={asset.id}><div className="text-xs font-semibold text-slate-700">{asset.title || asset.file_name}</div><div className="text-[10px] text-slate-400">{asset.file_type} · {asset.processing_status} · {asset.source || 'company upload'}</div></div>)}{assets.length === 0 && <p className="text-xs text-slate-400">No source documents linked.</p>}</div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-slate-900 text-white p-5">
          <BrainCircuit className="w-5 h-5 text-indigo-300" />
          <h2 className="font-bold mt-3">Grounded AI brief</h2>
          <p className="text-xs text-slate-300 mt-2 leading-relaxed">The AI receives the project definition, related concepts, {computed.length} registered metric formulas, {openTasks.length} open tasks, {tables.length} table schemas, and linked evidence. Numbers must be computed through registered metrics.</p>
          <Link href={`/chat?keyword_id=${project.id}&mode=report&prompt=${prompt}`} className="inline-flex items-center gap-2 mt-4 text-xs font-bold text-indigo-300 hover:text-white">Generate executive report <ArrowRight className="w-3.5 h-3.5" /></Link>
        </section>
      </div>
    </div>
  );
}

