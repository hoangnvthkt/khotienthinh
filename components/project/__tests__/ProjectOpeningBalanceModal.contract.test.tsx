import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as openingBalanceModalModule from '../ProjectOpeningBalanceModal';

describe('ProjectOpeningBalanceModal retry identity contract', () => {
  it('allows retry only after the current scope and opening-balance identity are both proven', () => {
    const isReady = (openingBalanceModalModule as any).isOpeningBalanceRetryReadyForScope;
    expect(isReady).toBeTypeOf('function');
    if (typeof isReady !== 'function') return;

    const base = {
      open: true,
      currentScopeKey: 'project-2_site-2',
      loadedScopeKey: 'project-2_site-2',
      openingBalanceId: 'opening-2',
      retryOpeningBalanceId: 'opening-2',
      canRetry: true,
    };
    expect(isReady(base)).toBe(true);
    expect(isReady({ ...base, loadedScopeKey: 'project-1_site-1' })).toBe(false);
    expect(isReady({ ...base, retryOpeningBalanceId: 'opening-1' })).toBe(false);
    expect(isReady({ ...base, open: false })).toBe(false);
  });

  it('clears prior opening and retry state before starting a new scope read', () => {
    const source = readFileSync(new URL('../ProjectOpeningBalanceModal.tsx', import.meta.url), 'utf8');
    const clearStart = source.indexOf('useLayoutEffect(() => {');
    const readStart = source.indexOf('projectOpeningBalanceService.getOpeningBalanceByScope(scopeKey)', clearStart);
    const effectPrefix = source.slice(clearStart, readStart);

    expect(clearStart).toBeGreaterThan(-1);
    expect(effectPrefix).toContain('setExistingOpening(null)');
    expect(effectPrefix).toContain('setSnapshotRetryState(null)');
    expect(effectPrefix).toContain('setOpeningLoadScopeKey(null)');
    expect(source).toContain('retryReadyForCurrentScope && snapshotRetryState');
  });

  it('fails closed while current-scope opening balance data is unavailable', () => {
    const source = readFileSync(new URL('../ProjectOpeningBalanceModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain("openingLoadState === 'error'");
    expect(source).toContain('Không thể tải số dư đầu kỳ');
    expect(source).toContain('setOpeningLoadRetryNonce');
    expect(source).toContain("openingLoadState !== 'ready'");
  });
});
