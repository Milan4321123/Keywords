import { OrgContext, roleAccessTier } from '@/lib/auth';

/**
 * Personal keyword scope for tier-1 members (workers).
 *
 * Returns null when the member is unrestricted (manager/admin tier, or a
 * worker with no assignments — they keep default worker-level visibility).
 * Otherwise returns the set of keyword ids the member may see:
 * every assigned keyword, all of its descendants (assign a branch → see the
 * subtree), and its ancestors (so drill-down navigation from the root works).
 */
export async function personalKeywordScope(ctx: OrgContext): Promise<Set<string> | null> {
  if (roleAccessTier(ctx.role) > 1) return null;

  const { data: assignments } = await ctx.supabase
    .from('keyword_assignments')
    .select('keyword_id')
    .eq('organization_id', ctx.org.id)
    .eq('member_id', ctx.memberId);
  if (!assignments || assignments.length === 0) return null;

  const { data: all } = await ctx.supabase
    .from('keywords')
    .select('id, parent_id')
    .eq('organization_id', ctx.org.id);

  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, string[]>();
  for (const row of all ?? []) {
    parentOf.set(row.id, row.parent_id ?? null);
    if (row.parent_id) {
      if (!childrenOf.has(row.parent_id)) childrenOf.set(row.parent_id, []);
      childrenOf.get(row.parent_id)!.push(row.id);
    }
  }

  const allowed = new Set<string>();
  for (const { keyword_id } of assignments) {
    // descendants (the assigned branch)
    const queue = [keyword_id];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (allowed.has(id)) continue;
      allowed.add(id);
      for (const child of childrenOf.get(id) ?? []) queue.push(child);
    }
    // ancestors (pass-through for navigation)
    let cursor = parentOf.get(keyword_id) ?? null;
    let guard = 0;
    while (cursor && guard < 30) {
      allowed.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
      guard++;
    }
  }
  return allowed;
}

/** True when the member may work with this keyword under their personal scope. */
export async function keywordInPersonalScope(ctx: OrgContext, keywordId: string): Promise<boolean> {
  const scope = await personalKeywordScope(ctx);
  return scope === null || scope.has(keywordId);
}
