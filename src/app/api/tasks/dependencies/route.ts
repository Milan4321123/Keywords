import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';

// POST /api/tasks/dependencies - { task_id, depends_on_task_id }
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_workflows');
    const { task_id, depends_on_task_id } = await req.json();

    if (!task_id || !depends_on_task_id || task_id === depends_on_task_id) {
      return NextResponse.json(
        { data: null, error: 'task_id and a different depends_on_task_id are required' },
        { status: 400 }
      );
    }

    const { data: tasks } = await ctx.supabase
      .from('tasks')
      .select('id')
      .eq('organization_id', ctx.org.id)
      .in('id', [task_id, depends_on_task_id]);
    if ((tasks ?? []).length !== 2) {
      return NextResponse.json({ data: null, error: 'Both tasks must exist in your organization' }, { status: 400 });
    }

    // Prevent trivial cycles (A→B when B→A exists)
    const { data: reverse } = await ctx.supabase
      .from('task_dependencies')
      .select('id')
      .eq('task_id', depends_on_task_id)
      .eq('depends_on_task_id', task_id)
      .maybeSingle();
    if (reverse) {
      return NextResponse.json(
        { data: null, error: 'That dependency would create a cycle' },
        { status: 400 }
      );
    }

    const { data: dependency, error } = await ctx.supabase
      .from('task_dependencies')
      .upsert(
        { organization_id: ctx.org.id, task_id, depends_on_task_id },
        { onConflict: 'task_id,depends_on_task_id', ignoreDuplicates: true }
      )
      .select()
      .maybeSingle();
    if (error) throw error;

    await audit(ctx, 'task.dependency_add', { type: 'task', id: task_id }, { depends_on: depends_on_task_id });
    return NextResponse.json({ data: dependency ?? { linked: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to add dependency');
  }
}

// DELETE /api/tasks/dependencies?id=
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_workflows');
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ data: null, error: 'id required' }, { status: 400 });
    }
    const { error } = await ctx.supabase
      .from('task_dependencies')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.org.id);
    if (error) throw error;
    await audit(ctx, 'task.dependency_remove', { type: 'task_dependency', id });
    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to remove dependency');
  }
}
