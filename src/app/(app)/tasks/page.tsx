'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ListChecks,
  Plus,
  Loader2,
  Trash2,
  Sparkles,
  Ban,
  Link2,
  Check,
} from 'lucide-react';
import { Keyword } from '@/types';

interface Member {
  id: string;
  role: string;
  profiles: { email: string; full_name: string | null } | null;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  parent_task_id: string | null;
  keyword?: { id: string; title: string } | null;
  assignee?: { id: string; profiles: { email: string; full_name: string | null } | null } | null;
  dependencies: Array<{ id: string; depends_on_task_id: string }>;
  blocked_by_open: string[];
  is_blocked: boolean;
}

interface ChecklistItem {
  title: string;
  description: string;
  priority: string;
}

const STATUS_COLUMNS = [
  { id: 'todo', label: 'To do', color: 'bg-slate-100 text-slate-600' },
  { id: 'in_progress', label: 'In progress', color: 'bg-blue-50 text-blue-700' },
  { id: 'blocked', label: 'Blocked', color: 'bg-red-50 text-red-700' },
  { id: 'done', label: 'Done', color: 'bg-emerald-50 text-emerald-700' },
];

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-amber-100 text-amber-700',
  medium: 'bg-slate-100 text-slate-600',
  low: 'bg-slate-50 text-slate-400',
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [depFor, setDepFor] = useState<Task | null>(null);
  const [checklistKeyword, setChecklistKeyword] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [checklistBusy, setChecklistBusy] = useState(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    keyword_id: '',
    priority: 'medium',
    assignee_member_id: '',
    due_date: '',
  });

  const load = async () => {
    const [tasksRes, keywordsRes, membersRes] = await Promise.all([
      fetch('/api/tasks').then((r) => r.json()),
      fetch('/api/keywords').then((r) => r.json()),
      fetch('/api/orgs/members').then((r) => r.json()),
    ]);
    setTasks(tasksRes.data ?? []);
    setKeywords(keywordsRes.data ?? []);
    setMembers(membersRes.data?.members ?? []);
  };

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description || undefined,
          keyword_id: form.keyword_id || undefined,
          priority: form.priority,
          assignee_member_id: form.assignee_member_id || undefined,
          due_date: form.due_date || undefined,
        }),
      });
      const { error } = await response.json();
      if (error) throw new Error(error);
      setForm({ title: '', description: '', keyword_id: '', priority: 'medium', assignee_member_id: '', due_date: '' });
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to create task');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (task: Task, status: string) => {
    await fetch('/api/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: task.id, status }),
    });
    await load();
  };

  const removeTask = async (task: Task) => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    await fetch(`/api/tasks?task_id=${task.id}`, { method: 'DELETE' });
    await load();
  };

  const addDependency = async (taskId: string, dependsOn: string) => {
    const response = await fetch('/api/tasks/dependencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, depends_on_task_id: dependsOn }),
    });
    const { error } = await response.json();
    if (error) setError(error);
    setDepFor(null);
    await load();
  };

  const generateChecklist = async () => {
    if (!checklistKeyword) return;
    setChecklistBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/tasks/checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword_id: checklistKeyword }),
      });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setChecklist(data.checklist);
    } catch (err: any) {
      setError(err.message || 'Checklist generation failed');
    } finally {
      setChecklistBusy(false);
    }
  };

  const acceptChecklist = async () => {
    if (!checklist) return;
    setChecklistBusy(true);
    for (const item of checklist) {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          description: item.description,
          keyword_id: checklistKeyword,
          priority: item.priority,
        }),
      });
    }
    setChecklist(null);
    setChecklistBusy(false);
    await load();
  };

  const memberName = (m: Member) => m.profiles?.full_name || m.profiles?.email || 'member';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  const blockedCount = tasks.filter((t) => t.is_blocked).length;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ListChecks className="w-6 h-6 text-slate-400" />
            Tasks
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {tasks.length} tasks
            {blockedCount > 0 && (
              <span className="text-red-600 font-medium"> · {blockedCount} blocked by dependencies</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={checklistKeyword}
            onChange={(e) => setChecklistKeyword(e.target.value)}
            className="px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-700 max-w-[180px]"
          >
            <option value="">AI checklist from…</option>
            {keywords.map((k) => (
              <option key={k.id} value={k.id}>{k.title}</option>
            ))}
          </select>
          <button
            onClick={generateChecklist}
            disabled={!checklistKeyword || checklistBusy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-indigo-50 border border-indigo-100 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            {checklistBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generate
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800"
          >
            <Plus className="w-4 h-4" /> New task
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {/* AI checklist approval */}
      {checklist && (
        <div className="bg-indigo-50/60 border border-indigo-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-indigo-700">
            <Sparkles className="w-4 h-4" /> Suggested checklist — review before creating
          </div>
          <ul className="space-y-1.5">
            {checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${PRIORITY_STYLES[item.priority]}`}>
                  {item.priority}
                </span>
                <span>
                  <span className="font-medium">{item.title}</span>
                  {item.description && <span className="text-slate-500"> — {item.description}</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              onClick={acceptChecklist}
              disabled={checklistBusy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              <Check className="w-4 h-4" /> Create {checklist.length} tasks
            </button>
            <button
              onClick={() => setChecklist(null)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 bg-white border border-slate-200"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={createTask} className="bg-white rounded-2xl border border-slate-200 p-5 grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Task title…"
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            />
          </div>
          <div className="sm:col-span-2">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description (optional)"
              rows={2}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
            />
          </div>
          <select
            value={form.keyword_id}
            onChange={(e) => setForm({ ...form, keyword_id: e.target.value })}
            className="px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
          >
            <option value="">No keyword</option>
            {keywords.map((k) => (
              <option key={k.id} value={k.id}>{k.title}</option>
            ))}
          </select>
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className="px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
          >
            {['low', 'medium', 'high', 'urgent'].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            value={form.assignee_member_id}
            onChange={(e) => setForm({ ...form, assignee_member_id: e.target.value })}
            className="px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{memberName(m)}</option>
            ))}
          </select>
          <input
            type="date"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            className="px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
          />
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 bg-white border border-slate-200">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Create task
            </button>
          </div>
        </form>
      )}

      {/* Board */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {STATUS_COLUMNS.map((column) => {
          const columnTasks = tasks.filter((t) =>
            column.id === 'blocked'
              ? t.status === 'blocked' || t.is_blocked
              : t.status === column.id && !(column.id !== 'done' && t.is_blocked)
          );
          return (
            <div key={column.id} className="bg-slate-50/70 rounded-2xl border border-slate-200 p-3">
              <div className="flex items-center justify-between px-1 mb-2">
                <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${column.color}`}>{column.label}</span>
                <span className="text-xs text-slate-400 font-medium">{columnTasks.length}</span>
              </div>
              <div className="space-y-2">
                {columnTasks.map((task) => (
                  <div key={task.id} className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800 leading-snug">{task.title}</span>
                      <button
                        onClick={() => removeTask(task)}
                        className="p-1 rounded text-slate-300 hover:text-red-500 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${PRIORITY_STYLES[task.priority]}`}>
                        {task.priority}
                      </span>
                      {task.keyword && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-medium">
                          {task.keyword.title}
                        </span>
                      )}
                      {task.due_date && (
                        <span className="text-[10px] text-slate-400">due {task.due_date}</span>
                      )}
                      {task.assignee?.profiles && (
                        <span className="text-[10px] text-slate-400">
                          @{task.assignee.profiles.full_name || task.assignee.profiles.email}
                        </span>
                      )}
                    </div>
                    {task.is_blocked && (
                      <div className="flex items-start gap-1.5 text-[11px] text-red-600 bg-red-50 rounded-lg px-2 py-1.5">
                        <Ban className="w-3 h-3 shrink-0 mt-0.5" />
                        Waiting on: {task.blocked_by_open.map((id) => taskById.get(id)?.title ?? '…').join(', ')}
                      </div>
                    )}
                    <div className="flex items-center gap-1 pt-1">
                      <select
                        value={task.status}
                        onChange={(e) => setStatus(task, e.target.value)}
                        className="flex-1 px-2 py-1 text-[11px] rounded-lg border border-slate-200 bg-slate-50"
                      >
                        {['todo', 'in_progress', 'blocked', 'done', 'cancelled'].map((s) => (
                          <option key={s} value={s}>{s.replace('_', ' ')}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setDepFor(depFor?.id === task.id ? null : task)}
                        title="Add dependency"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {depFor?.id === task.id && (
                      <select
                        onChange={(e) => e.target.value && addDependency(task.id, e.target.value)}
                        defaultValue=""
                        className="w-full px-2 py-1.5 text-[11px] rounded-lg border border-blue-200 bg-blue-50/50"
                      >
                        <option value="">This task depends on…</option>
                        {tasks
                          .filter((t) => t.id !== task.id)
                          .map((t) => (
                            <option key={t.id} value={t.id}>{t.title}</option>
                          ))}
                      </select>
                    )}
                  </div>
                ))}
                {columnTasks.length === 0 && (
                  <p className="text-xs text-slate-300 text-center py-4">Empty</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
