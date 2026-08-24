import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePath = '../safetyWorkforceCache';

const loadCache = async () => {
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch {
    return null;
  }
};

const siteOne = { userId: 'user-1', projectId: 'project-1', constructionSiteId: 'site-1' };

describe('safetyWorkforceCache', () => {
  beforeEach(async () => {
    const cache = await loadCache();
    cache?.clearSafetyWorkforceCache();
    cache?.setSafetyWorkforceCacheActor(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the reusable scoped cache boundary', async () => {
    // Break caught: deleting the shared cache must fail both the future Safety
    // module and the current Project-scoped consumer.
    expect(await loadCache()).not.toBeNull();
  });

  it('deduplicates concurrent reads for the same scoped key', async () => {
    const cache = await loadCache();
    expect(cache).not.toBeNull();
    const loader = vi.fn(async () => ({ items: ['worker-1'] }));
    const key = cache!.buildSafetyWorkforceCacheKey(siteOne, 'roster');

    const [first, second] = await Promise.all([
      cache!.getSafetyWorkforceCached(key, 60_000, loader),
      cache!.getSafetyWorkforceCached(key, 60_000, loader),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('expires a cached value after its TTL', async () => {
    vi.useFakeTimers();
    const cache = await loadCache();
    expect(cache).not.toBeNull();
    let sequence = 0;
    const loader = vi.fn(async () => ({ sequence: ++sequence }));
    const key = cache!.buildSafetyWorkforceCacheKey(siteOne, 'dashboard');

    expect(await cache!.getSafetyWorkforceCached(key, 1_000, loader)).toEqual({ sequence: 1 });
    await vi.advanceTimersByTimeAsync(999);
    expect(await cache!.getSafetyWorkforceCached(key, 1_000, loader)).toEqual({ sequence: 1 });
    await vi.advanceTimersByTimeAsync(2);
    expect(await cache!.getSafetyWorkforceCached(key, 1_000, loader)).toEqual({ sequence: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('separates users, projects, sites and stable filter variants in cache keys', async () => {
    const cache = await loadCache();
    expect(cache).not.toBeNull();

    const base = cache!.buildSafetyWorkforceCacheKey(siteOne, 'roster', { search: 'anh', limit: 50 });
    expect(cache!.buildSafetyWorkforceCacheKey(siteOne, 'roster', { limit: 50, search: 'anh' })).toBe(base);
    expect(cache!.buildSafetyWorkforceCacheKey({ ...siteOne, userId: 'user-2' }, 'roster')).not.toBe(base);
    expect(cache!.buildSafetyWorkforceCacheKey({ ...siteOne, projectId: 'project-2' }, 'roster')).not.toBe(base);
    expect(cache!.buildSafetyWorkforceCacheKey({ ...siteOne, constructionSiteId: 'site-2' }, 'roster')).not.toBe(base);
  });

  it('invalidates only selected resources inside the exact scope', async () => {
    const cache = await loadCache();
    expect(cache).not.toBeNull();
    const dashboardLoader = vi.fn(async () => ({ total: 1 }));
    const rosterLoader = vi.fn(async () => ({ items: ['worker-1'] }));
    const otherSiteLoader = vi.fn(async () => ({ items: ['worker-2'] }));
    const dashboardKey = cache!.buildSafetyWorkforceCacheKey(siteOne, 'dashboard');
    const rosterKey = cache!.buildSafetyWorkforceCacheKey(siteOne, 'roster');
    const otherRosterKey = cache!.buildSafetyWorkforceCacheKey(
      { ...siteOne, constructionSiteId: 'site-2' },
      'roster',
    );

    await cache!.getSafetyWorkforceCached(dashboardKey, 60_000, dashboardLoader);
    await cache!.getSafetyWorkforceCached(rosterKey, 60_000, rosterLoader);
    await cache!.getSafetyWorkforceCached(otherRosterKey, 60_000, otherSiteLoader);
    cache!.invalidateSafetyWorkforceScope(siteOne, ['roster']);
    await cache!.getSafetyWorkforceCached(dashboardKey, 60_000, dashboardLoader);
    await cache!.getSafetyWorkforceCached(rosterKey, 60_000, rosterLoader);
    await cache!.getSafetyWorkforceCached(otherRosterKey, 60_000, otherSiteLoader);

    expect(dashboardLoader).toHaveBeenCalledTimes(1);
    expect(rosterLoader).toHaveBeenCalledTimes(2);
    expect(otherSiteLoader).toHaveBeenCalledTimes(1);
  });

  it('deep-freezes successful object and array payloads', async () => {
    const cache = await loadCache();
    expect(cache).not.toBeNull();
    const key = cache!.buildSafetyWorkforceCacheKey(siteOne, 'detail');
    const payload = await cache!.getSafetyWorkforceCached(key, 60_000, async () => ({
      worker: { id: 'worker-1' },
      documents: [{ id: 'document-1' }],
    }));

    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.worker)).toBe(true);
    expect(Object.isFrozen(payload.documents)).toBe(true);
    expect(Object.isFrozen(payload.documents[0])).toBe(true);
    expect(() => payload.documents.push({ id: 'document-2' })).toThrow();
  });

  it('clears every cached scope when the authenticated actor changes', async () => {
    const cache = await loadCache();
    expect(cache).not.toBeNull();
    const loader = vi.fn(async () => ({ ok: true }));
    const key = cache!.buildSafetyWorkforceCacheKey(siteOne, 'options');

    cache!.setSafetyWorkforceCacheActor('user-1');
    await cache!.getSafetyWorkforceCached(key, 60_000, loader);
    cache!.setSafetyWorkforceCacheActor('user-1');
    await cache!.getSafetyWorkforceCached(key, 60_000, loader);
    cache!.setSafetyWorkforceCacheActor('user-2');
    await cache!.getSafetyWorkforceCached(key, 60_000, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not retain a rejected in-flight read', async () => {
    const cache = await loadCache();
    expect(cache).not.toBeNull();
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ ok: true });
    const key = cache!.buildSafetyWorkforceCacheKey(siteOne, 'card_lookup');

    await expect(cache!.getSafetyWorkforceCached(key, 60_000, loader)).rejects.toThrow('temporary failure');
    await expect(cache!.getSafetyWorkforceCached(key, 60_000, loader)).resolves.toEqual({ ok: true });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
