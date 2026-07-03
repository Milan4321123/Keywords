import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';

const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

// GET /api/tasks - Tasks with dependencies and computed blocked state
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const { searchParams } = new URL(req.url);
    const keywordId = searchParams.get('keyword_id');

    let query = ctx.supabase
      .from('tasks')
      .select(`
        *,
        keyword:keywords(id, title),
        assignee:organization_members(id, profiles(email, full_name)),
        dependencies:task_dependencies!task_dependencies_task_id_fkey(id, depends_on_task_id)
      `)
      .eq('organization_id', ctx.org.id)
      .order('created_at', { ascending: false })
      .limit(300);
    if (keywordId) query = query.eq('keyword_id', keywordId);

    const { data: tasks, error } = await query;
    if (error) throw error;

    // A task is effectively blocked when any dependency is not done/cancelled
    const statusById = new Map((tasks ?? []).map((t: any) => [t.id, t.status]));
    const enriched = (tasks ?? []).map((t: any) => {
      const openDeps = (t.dependencies ?? []).filter((d: any) => {
        const depStatus = statusById.get(d.depends_on_task_id);
        return depStatus && depStatus !== 'done' && depStatus !== 'cancelled';
      });
      return {
        ...t,
        blocked_by_open: openDeps.map((d: any) => d.depends_on_task_id),
        is_blocked: openDeps.length > 0 && t.status !== 'done' && t.status !== 'cancelled',
      };
    });

    return NextResponse.json({ data: enriched, error: null });
  } catch (error) {
    return apiError(error, 'Failed to list tasks');
  }
}

// POST /api/tasks - Create a task
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_workflows');
    const body = await req.json();

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return NextResponse.json({ data: null, error: 'title is required' }, { status: 400 });
    }

    for (const [field, table] of [
      ['keyword_id', 'keywords'],
      ['parent_task_id', 'tasks'],
    ] as const) {
      if (body[field]) {
        const { data: row } = await ctx.supabase
          .from(table)
          .select('id')
          .eq('id', body[field])
          .eq('organization_id', ctx.org.id)
          .maybeSingle();
        if (!row) {
          return NextResponse.json({ data: null, error: `${field} not found` }, { status: 400 });
        }
      }
    }

    const { data: task, error } = await ctx.supabase
      .from('tasks')
      .insert({
        organization_id: ctx.org.id,
        title,
        description: body.description || null,
        keyword_id: body.keyword_id || null,
        parent_task_id: body.parent_task_id || null,
        status: TASK_STATUSES.includes(body.status) ? body.status : 'todo',
        priority: PRIORITIES.includes(body.priority) ? body.priority : 'medium',
        assignee_member_id: body.assignee_member_id || null,
        due_date: body.due_date || null,
        source_asset_id: body.source_asset_id || null,
        created_by: ctx.user.id,
      })
      .select()
      .single();
    if (error) throw error;

    await audit(ctx, 'task.create', { type: 'task', id: task.id }, { title });
    return NextResponse.json({ data: task, error: null });
  } catch (error) {
    return apiError(error, 'Failed to create task');
  }
}

// PATCH /api/tasks - Update a task: { task_id, ...fields }
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_workflows');
    const body = await req.json();
    const taskId = body.task_id;
    if (!taskId) {
      return NextResponse.json({ data: null, error: 'task_id required' }, { status: 400 });
    }

    const updates: Record<string, any> = {};
    if (typeof body.title === 'string' && body.title.trim()) updates.title = body.title.trim();
    if ('description' in body) updates.description = body.description || null;
    if (TASK_STATUSES.includes(body.status)) updates.status = body.status;
    if (PRIORITIES.includes(body.priority)) updates.priority = body.priority;
    if ('assignee_member_id' in body) updates.assignee_member_id = body.assignee_member_id || null;
    if ('due_date' in body) updates.due_date = body.due_date || null;
    if ('keyword_id' in body) updates.keyword_id = body.keyword_id || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ data: null, error: 'No updatable fields' }, { status: 400 });
    }

    const { data: task, error } = await ctx.supabase
      .from('tasks')
      .update(updates)
      .eq('id', taskId)
      .eq('organization_id', ctx.org.id)
      .select()
      .single();
    if (error) throw error;

    await audit(ctx, 'task.update', { type: 'task', id: taskId }, { fields: Object.keys(updates) });
    return NextResponse.json({ data: task, error: null });
  } catch (error) {
    return apiError(error, 'Failed to update task');
  }
}

// DELETE /api/tasks?task_id=
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_workflows');
    const taskId = new URL(req.url).searchParams.get('task_id');
    if (!taskId) {
      return NextResponse.json({ data: null, error: 'task_id required' }, { status: 400 });
    }
    const { error } = await ctx.supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .eq('organization_id', ctx.org.id);
    if (error) throw error;
    await audit(ctx, 'task.delete', { type: 'task', id: taskId });
    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to delete task');
  }
}
