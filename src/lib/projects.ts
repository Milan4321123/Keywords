export interface ProjectKeywordCandidate {
  id: string;
  title: string;
  slug: string;
  parent_id: string | null;
  keyword_type?: string | null;
  labels_json?: Record<string, unknown> | null;
}

export interface ProjectTaskSignal {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  is_blocked?: boolean;
}

export interface ProjectAttentionItem {
  id: string;
  kind: 'blocker' | 'overdue' | 'risk' | 'decision';
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  owner?: string | null;
  dueDate?: string | null;
}

export function isProjectKeyword(keyword: ProjectKeywordCandidate): boolean {
  const labels = keyword.labels_json ?? {};
  if (labels.is_project === true || labels.object_type === 'project') return true;
  if (keyword.keyword_type === 'project') return true;
  return /(^|[-_\s])project([-_\s]|$)/i.test(`${keyword.title} ${keyword.slug}`);
}

export function classifyProjectTable(name: string): 'control' | 'risk' | 'decision' | 'stakeholder' | 'other' {
  const value = name.toLocaleLowerCase();
  if (/risk|risiko/.test(value)) return 'risk';
  if (/decision|entscheidung/.test(value)) return 'decision';
  if (/stakeholder|interessent/.test(value)) return 'stakeholder';
  if (/control|plan|work.?package|steuerung/.test(value)) return 'control';
  return 'other';
}

function asText(value: unknown): string {
  return value == null ? '' : String(value);
}

/** Build an evidence-backed management attention list from tasks and table rows. */
export function buildProjectAttention(
  tasks: ProjectTaskSignal[],
  tables: Array<{ id: string; name: string; rows: Array<Record<string, unknown>> }>,
  today = new Date()
): ProjectAttentionItem[] {
  const todayKey = today.toISOString().slice(0, 10);
  const result: ProjectAttentionItem[] = [];
  for (const task of tasks) {
    if (['done', 'cancelled'].includes(task.status)) continue;
    if (task.status === 'blocked' || task.is_blocked) {
      result.push({
        id: `task-blocked-${task.id}`,
        kind: 'blocker',
        severity: 'critical',
        title: task.title,
        detail: 'Task is blocked by status or an unfinished dependency.',
        dueDate: task.due_date,
      });
    } else if (task.due_date && task.due_date < todayKey) {
      result.push({
        id: `task-overdue-${task.id}`,
        kind: 'overdue',
        severity: task.priority === 'urgent' || task.priority === 'high' ? 'critical' : 'warning',
        title: task.title,
        detail: `Task was due ${task.due_date}.`,
        dueDate: task.due_date,
      });
    }
  }
  for (const table of tables) {
    const type = classifyProjectTable(table.name);
    for (let index = 0; index < table.rows.length; index++) {
      const row = table.rows[index];
      if (type === 'risk' && !['closed', 'accepted', 'resolved'].includes(asText(row.status).toLowerCase())) {
        const exposure = Number(row.exposure_eur);
        const highProbability = Number(row.probability_pct) >= 60;
        if ((Number.isFinite(exposure) && exposure >= 25_000) || highProbability) {
          result.push({
            id: `${table.id}-risk-${index}`,
            kind: 'risk',
            severity: exposure >= 40_000 || highProbability ? 'critical' : 'warning',
            title: asText(row.title) || asText(row.risk_id) || 'Open project risk',
            detail: [
              Number.isFinite(exposure) ? `Exposure €${exposure.toLocaleString('en-US')}` : '',
              asText(row.mitigation),
            ].filter(Boolean).join(' · '),
            owner: asText(row.owner) || null,
            dueDate: asText(row.due_date) || null,
          });
        }
      }
      if (type === 'decision' && ['open', 'pending'].includes(asText(row.status).toLowerCase())) {
        result.push({
          id: `${table.id}-decision-${index}`,
          kind: 'decision',
          severity: 'warning',
          title: asText(row.title) || asText(row.decision_id) || 'Open project decision',
          detail: asText(row.impact) || asText(row.context) || 'Decision is awaiting approval.',
          owner: asText(row.owner) || null,
          dueDate: asText(row.review_date) || null,
        });
      }
    }
  }
  const severityRank = { critical: 0, warning: 1 } as const;
  const kindRank = { blocker: 0, overdue: 1, risk: 2, decision: 3 } as const;
  return result.sort((a, b) =>
    severityRank[a.severity] - severityRank[b.severity] || kindRank[a.kind] - kindRank[b.kind]
  );
}

