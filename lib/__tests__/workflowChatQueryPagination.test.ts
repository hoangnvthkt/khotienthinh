import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryState = vi.hoisted(() => ({
  limits: [] as Array<{ table: string; value: number }>,
}));

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => {
      const query: any = {
        select: () => query,
        eq: () => query,
        is: () => query,
        order: () => query,
        or: () => query,
        lt: () => query,
        in: () => query,
        limit: (value: number) => {
          queryState.limits.push({ table, value });
          return query;
        },
        then: (resolveQuery: (value: unknown) => void) => {
          const data = table === 'chat_v2_messages'
            ? [
              { id: 'm3', conversation_id: 'c1', sender_id: 'u1', body: '3', kind: 'text', metadata: {}, payload: {}, created_at: '2026-09-03T03:00:00.000Z', updated_at: '2026-09-03T03:00:00.000Z' },
              { id: 'm2', conversation_id: 'c1', sender_id: 'u1', body: '2', kind: 'text', metadata: {}, payload: {}, created_at: '2026-09-03T02:00:00.000Z', updated_at: '2026-09-03T02:00:00.000Z' },
              { id: 'm1', conversation_id: 'c1', sender_id: 'u1', body: '1', kind: 'text', metadata: {}, payload: {}, created_at: '2026-09-03T01:00:00.000Z', updated_at: '2026-09-03T01:00:00.000Z' },
            ]
            : [];
          resolveQuery({ data, error: null });
        },
      };
      return query;
    },
    storage: { from: () => ({}) },
  },
}));

describe('workflow and chat query pagination', () => {
  beforeEach(() => {
    queryState.limits.length = 0;
  });

  it('requests one look-ahead chat row and returns a stable composite cursor', async () => {
    const { chatV2Service } = await import('../chatV2Service');
    const page = await chatV2Service.getMessagesPage('c1', 'u1', undefined, 2);

    expect(queryState.limits).toContainEqual({ table: 'chat_v2_messages', value: 3 });
    expect(page.items.map(message => message.id)).toEqual(['m2', 'm3']);
    expect(page.nextCursor).toEqual({ createdAt: '2026-09-03T02:00:00.000Z', id: 'm2' });
  });

  it('scopes workflow nodes and edges through active template IDs', () => {
    const source = readFileSync(resolve(process.cwd(), 'context/WorkflowContext.tsx'), 'utf8');
    expect(source).toContain("loadWorkflowRowsByIds('workflow_nodes', WORKFLOW_NODE_SELECT, 'template_id', activeTemplateIds)");
    expect(source).toContain("loadWorkflowRowsByIds('workflow_edges', WORKFLOW_EDGE_SELECT, 'template_id', activeTemplateIds)");
    expect(source).not.toContain("supabase.from('workflow_nodes').select('*')");
    expect(source).not.toContain("supabase.from('workflow_edges').select('*')");
  });
});
