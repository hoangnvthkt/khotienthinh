import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWorkItems = vi.fn();
vi.mock('../workItemsService', () => ({ fetchWorkItems: (...args: unknown[]) => fetchWorkItems(...args) }));

const page = (total: number) => ({ tab: 'mine', generatedAt: '', total, truncatedSources: [], items: [] });

describe('shared "waiting for me" source (Center, Sidebar badge, Home)', () => {
  beforeEach(async () => {
    fetchWorkItems.mockReset();
    (await import('../workItemsStore')).resetWorkItemsStore();
  });

  it('calls the server once for concurrent readers and reuses the result for a minute', async () => {
    const { loadWorkItemsShared } = await import('../workItemsStore');
    fetchWorkItems.mockResolvedValue(page(9));
    const [a, b] = await Promise.all([loadWorkItemsShared('mine'), loadWorkItemsShared('mine')]);
    expect(a.total).toBe(9);
    expect(b).toBe(a);
    expect(await loadWorkItemsShared('mine')).toBe(a);
    expect(fetchWorkItems).toHaveBeenCalledTimes(1);
  });

  it('refetches on force and for other tabs', async () => {
    const { loadWorkItemsShared } = await import('../workItemsStore');
    fetchWorkItems.mockResolvedValueOnce(page(9)).mockResolvedValueOnce(page(8)).mockResolvedValueOnce({ ...page(3), tab: 'sent' });
    await loadWorkItemsShared('mine');
    expect((await loadWorkItemsShared('mine', { force: true })).total).toBe(8);
    expect((await loadWorkItemsShared('sent')).total).toBe(3);
    expect(fetchWorkItems).toHaveBeenCalledTimes(3);
  });

  it('does not cache failures', async () => {
    const { loadWorkItemsShared } = await import('../workItemsStore');
    fetchWorkItems.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page(2));
    await expect(loadWorkItemsShared('mine')).rejects.toThrow('offline');
    expect((await loadWorkItemsShared('mine')).total).toBe(2);
  });
});
