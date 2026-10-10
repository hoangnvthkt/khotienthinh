import { describe, expect, it, vi } from 'vitest';
import { registerCenterOpener, requestCenterOpen } from '../centerOpen';
import { blocksOf, parseCenterLayout, resolveCenterLayout, withBlocks, withPinnedActions } from '../centerLayout';
import { embedDataModules } from '../embedData';
import { stockRows } from '../../../components/dashboard/StockTable';

describe('opening screens as Center tabs (owner 10/10)', () => {
  it('delivers a request made before the Center opened, then opens directly', () => {
    expect(requestCenterOpen({ route: '/procurement', title: 'Mua hàng' })).toBe(false);
    const opener = vi.fn();
    const off = registerCenterOpener(opener);
    expect(opener).toHaveBeenCalledWith({ route: '/procurement', title: 'Mua hàng' });
    expect(requestCenterOpen({ route: '/inventory' })).toBe(true);
    expect(opener).toHaveBeenLastCalledWith({ route: '/inventory' });
    off();
    expect(requestCenterOpen({ route: '/settings' })).toBe(false);
    off();
    registerCenterOpener(vi.fn())();
  });

  it('loads the shared data each screen needs inside a tab, like the main router', () => {
    expect(embedDataModules('/operations')).toEqual({ modules: ['wms'], workflow: false });
    expect(embedDataModules('/da')).toEqual({ modules: ['da', 'admin', 'hrm'], workflow: false });
    expect(embedDataModules('/hrm/checkin').modules).toEqual([]);
    expect(embedDataModules('/hrm/leave').modules).toEqual(['hrm']);
    expect(embedDataModules('/wf/dashboard')).toEqual({ modules: ['workflow-people'], workflow: true });
    expect(embedDataModules('/finance/cost').modules).toEqual([]);
  });
});

describe('Today blocks', () => {
  it('defaults to quick access, keeps an emptied list, drops unknown blocks', () => {
    expect(blocksOf(null)).toEqual(['quick']);
    expect(parseCenterLayout({ blocks: [] })?.blocks).toEqual([]);
    expect(parseCenterLayout({ blocks: ['board:debt', 'nope', 'board:debt', 'quick'] })?.blocks).toEqual(['board:debt', 'quick']);
  });

  it('saving blocks keeps tile order and pinned actions, and the other way round', () => {
    const saved = { widgets: { order: ['hrm' as const], hidden: [] }, pinned: { hrm: ['checkin'] } };
    const withB = withBlocks(saved, ['board:portfolio', 'quick', 'quick']);
    expect(withB).toEqual({ widgets: saved.widgets, pinned: saved.pinned, blocks: ['board:portfolio', 'quick'] });
    expect(withPinnedActions(withB, 'hrm', ['leave']).blocks).toEqual(['board:portfolio', 'quick']);
    expect(resolveCenterLayout(withB, { widgets: { order: [], hidden: [] } }).blocks).toEqual(['board:portfolio', 'quick']);
  });
});

describe('stock table', () => {
  it('adds projects up per material; remaining = BOQ − (in + in transit + ordered − returned to supplier)', () => {
    const rows = stockRows([
      { projectId: 'a', key: 'i1', itemId: 'i1', name: 'Thép', code: 'VT-1', unit: 'kg', boq: 100, ordered: 10, transit: 5, imported: 80, exported: 50, returned: 4, stock: 26 },
      { projectId: 'b', key: 'i1', itemId: 'i1', name: 'Thép', code: 'VT-1', unit: 'kg', boq: 50, ordered: 0, transit: 0, imported: 70, exported: 40, returned: 0, stock: 30 },
      { projectId: 'a', key: 'name:cát', itemId: null, name: 'Cát', code: null, unit: 'm3', boq: null, ordered: 0, transit: 0, imported: 0, exported: 0, returned: 0, stock: 0 },
    ]);
    expect(rows.map(row => row.name)).toEqual(['Cát', 'Thép']);
    const steel = rows[1];
    expect(steel).toMatchObject({ boq: 150, ordered: 10, transit: 5, imported: 150, exported: 90, returned: 4, stock: 56 });
    // 150 − (150 + 5 + 10 − 4) = −11: đã đặt / mua vượt BOQ.
    expect(steel.remaining).toBe(-11);
    expect(steel.boqByProject).toEqual([{ projectId: 'a', boq: 100 }, { projectId: 'b', boq: 50 }]);
    expect(rows[0].remaining).toBeNull();
  });
});
