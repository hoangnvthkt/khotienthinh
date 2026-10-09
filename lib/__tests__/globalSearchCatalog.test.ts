import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildActionEntries, buildPageEntries, featuredActions, quickActionDefs } from '../search/searchCatalog';
import { KIND_META, recordTarget, recordToEntry, statusInfo } from '../search/recordPresentation';
import { parseSearchResponse } from '../search/globalSearchService';
import { RECORD_KINDS, type ServerRecord } from '../search/searchTypes';

const record = (overrides: Partial<ServerRecord>): ServerRecord => ({
  kind: 'project', id: 'id-1', code: null, title: 'Tiêu đề', subtitle: null, status: null, date: null,
  projectId: null, siteId: null, rank: 40, extra: {}, ...overrides,
});

describe('search catalog', () => {
  const modules = [{ key: 'WMS', label: 'Vật tư', route: '/inventory' }, { key: 'FINANCE', label: 'Tài chính', route: '/finance' }];
  const itemsOf = (key: string) => key === 'WMS'
    ? [{ to: '/inventory', label: 'Tồn kho' }, { to: '/reports', label: 'Báo cáo' }]
    : [{ to: '/finance/overview', label: 'Tổng quan' }];

  it('lists the sidebar functions the user has, with generic labels qualified by the app', () => {
    const pages = buildPageEntries(modules, itemsOf, route => route !== '/center');
    const titles = pages.map(page => page.title);
    expect(titles).toContain('Tồn kho');
    expect(titles).toContain('Báo cáo · Vật tư');
    expect(titles).toContain('Tổng quan · Tài chính');
    expect(titles).toContain('Hồ sơ của tôi');
    expect(titles).not.toContain('Trung tâm điều hành');
    expect(pages.find(page => page.route === '/inventory')?.keywords).toContain('ton kho');
  });

  it('offers project tabs as "choose a project first" pages only when the tab is allowed', () => {
    const pages = buildPageEntries([], () => [], route => route === '/da/tabs/dailylog');
    const tabs = pages.filter(page => page.needsProject);
    expect(tabs.map(page => page.needsProject?.tab)).toEqual(['dailylog']);
    expect(tabs[0].title).toBe('Nhật ký dự án');
  });

  it('hides quick actions whose screen the user cannot open', () => {
    const defs = quickActionDefs(new Date(2026, 9, 9));
    const actions = buildActionEntries(defs, route => route === '/hrm/checkin' || route === '/');
    expect(actions.map(action => action.key)).toEqual(['action:checkin', 'action:theme']);
  });

  it('builds the week-plan action for the current Monday and the leave action as an in-place form', () => {
    const defs = quickActionDefs(new Date(2026, 9, 9));
    expect(defs.find(def => def.id === 'work-plan')?.needsProject?.extra?.start).toBe('2026-10-05');
    expect(defs.find(def => def.id === 'leave')?.modal).toBe('leave');
    expect(defs.find(def => def.id === 'import')?.routeState).toEqual({ tab: 'IMPORT' });
  });

  it('puts the actions a person uses most first in the empty state', () => {
    const defs = quickActionDefs(new Date(2026, 9, 9));
    const actions = buildActionEntries(defs, () => true);
    const usage = (key: string) => (key === 'action:count' ? 5 : 0);
    const featured = featuredActions(actions, defs, usage, 3);
    expect(featured.map(action => action.key)).toEqual(['action:count', 'action:checkin', 'action:leave']);
  });
});

describe('record presentation', () => {
  it('opens each record on the exact screen', () => {
    expect(recordTarget(record({ kind: 'project', id: 'p1' })).route).toBe('/da?projectId=p1');
    expect(recordTarget(record({ kind: 'purchase_order', id: 'po1', projectId: 'p1' })).route).toBe('/procurement?po=po1');
    expect(recordTarget(record({ kind: 'wms_tx', id: 'tx1' }))).toMatchObject({ route: '/operations', state: { transactionId: 'tx1' } });
    expect(recordTarget(record({ kind: 'item', id: 'i1', code: 'VT0000123' })).route).toBe('/inventory?q=VT0000123');
    expect(recordTarget(record({ kind: 'rq', id: 'r1' })).route).toBe('/rq/r1');
    expect(recordTarget(record({ kind: 'wf', id: 'w1' })).route).toBe('/wf/w1');
    expect(recordTarget(record({ kind: 'employee', id: 'e1' })).route).toBe('/ep/e1');
    expect(recordTarget(record({ kind: 'payment_request', id: 'f1' })).route).toBe('/finance/requests?request=f1');
    expect(recordTarget(record({ kind: 'work_task', id: 't1', code: 'CV-12' })).route).toBe('/work/tasks/CV-12');
    expect(recordTarget(record({ kind: 'customer_contract', id: 'c1' })).route).toBe('/hd/customer/c1');
  });

  it('opens project material requests inside the project and warehouse ones on the request list', () => {
    expect(recordTarget(record({ kind: 'material_request', id: 'm1', code: 'YC-1', projectId: 'p1', siteId: 's1', extra: { origin: 'project' } })).route)
      .toBe('/da?projectId=p1&siteId=s1&tab=material&materialTab=request&requestId=m1');
    expect(recordTarget(record({ kind: 'material_request', id: 'm2', code: 'YC-2', extra: { origin: 'wms' } })).route).toBe('/requests?q=YC-2');
  });

  it('opens an issued material code straight on the item, otherwise the waiting queue', () => {
    expect(recordTarget(record({ kind: 'material_code', id: 'mc1', extra: { approvedItemId: 'i9' } }))).toMatchObject({ route: '/material-code-requests', state: { itemId: 'i9' } });
    expect(recordTarget(record({ kind: 'material_code', id: 'mc2' })).state).toBeUndefined();
  });

  it('offers related actions — call a person, open project tabs', () => {
    const person = recordTarget(record({ kind: 'employee', id: 'e1', extra: { phone: '0912 345 678' } }));
    expect(person.related[0]).toEqual({ label: 'Gọi 0912 345 678', route: 'tel:0912345678' });
    const project = recordTarget(record({ kind: 'project', id: 'p1' }));
    expect(project.related.map(link => link.label)).toContain('Nhật ký công trường');
  });

  it('labels status in Vietnamese with a meaning-based tone', () => {
    expect(statusInfo('purchase_order', 'sent')).toEqual({ label: 'Chờ duyệt', tone: 'pending' });
    expect(statusInfo('rq', 'APPROVED')).toEqual({ label: 'Hoàn thành', tone: 'done' });
    expect(statusInfo(null, 'rejected')).toEqual({ label: 'Từ chối', tone: 'warn' });
    expect(statusInfo(null, 'something_new')).toEqual({ label: 'something_new', tone: 'neutral' });
  });

  it('shows money as a number fact and never invents a zero', () => {
    const entry = recordToEntry(record({ kind: 'purchase_order', id: 'po1', code: 'PO-1', extra: { amount: 12500000, vendor: 'Hòa Phát' } }));
    expect(entry.facts).toContainEqual({ label: 'Giá trị', value: '12.500.000 đ', tone: 'num' });
    const empty = recordToEntry(record({ kind: 'purchase_order', id: 'po2', extra: { amount: null } }));
    expect(empty.facts?.some(fact => fact.label === 'Giá trị')).toBe(false);
  });

  it('only labels a status when it is out of the ordinary', () => {
    expect(recordToEntry(record({ kind: 'item', id: 'i1', status: 'active' })).status).toBeNull();
    expect(recordToEntry(record({ kind: 'item', id: 'i2', status: 'retired' })).status).toBe('Ngừng dùng');
    expect(recordToEntry(record({ kind: 'project', id: 'p1', status: 'paused' })).status).toBe('Tạm dừng');
  });

  it('gates every record kind behind at least one screen', () => {
    RECORD_KINDS.forEach(kind => expect(KIND_META[kind].gates.length).toBeGreaterThan(0));
  });
});

describe('server response parsing', () => {
  it('drops unknown kinds and malformed rows', () => {
    const parsed = parseSearchResponse({
      records: [{ kind: 'project', id: 'p1', title: 'A', rank: 100 }, { kind: 'nope', id: 'x' }, { kind: 'item' }, null],
      failed: ['wms_tx', 'nope'],
    });
    expect(parsed.records.map(item => [item.id, item.rank])).toEqual([['p1', 100]]);
    expect(parsed.failed).toEqual(['wms_tx']);
  });
});

describe('global search migration contract', () => {
  const sql = readFileSync('supabase/migrations/20261010110000_global_search_v1.sql', 'utf8');

  it('runs the public function with the caller rights and keeps the privileged step out of the API schema', () => {
    expect(sql).toMatch(/create function public\.search_global_v1\([^)]*\)\s*returns jsonb language plpgsql stable security invoker/);
    expect(sql).toMatch(/create function app_private\.gs_candidates_v1\([^)]*\)\s*returns table\(cand_id text, cand_rank integer, cand_ord bigint\)\s*language plpgsql stable security definer/);
    expect(sql).toContain("revoke all on function public.search_global_v1(jsonb, text[], integer) from public, anon;");
    expect(sql).not.toMatch(/grant execute on function public\.search_global_v1[^;]*anon/);
  });

  it('searches exactly the record kinds the app knows about', () => {
    const declared = sql.match(/c_all_kinds constant text\[\] := array\[([^\]]+)\]/)?.[1] || '';
    const kinds = [...declared.matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
    expect([...kinds].sort()).toEqual([...RECORD_KINDS].sort());
    RECORD_KINDS.filter(kind => kind !== 'employee').forEach(kind => {
      expect(sql).toContain(`if p_kind = '${kind}' then`);
      expect(sql).toContain(`if '${kind}' = any(v_kinds) then`);
    });
    expect(sql).toContain('public.list_hrm_employee_directory()');
  });

  it('reads candidate rows back through an index lookup so table RLS only runs on candidates', () => {
    const blocks = sql.split('-- Bước 2')[1];
    const lookups = blocks.match(/\.id = any \(v_ids(::uuid\[\])?\)/g) || [];
    expect(lookups.length).toBe(RECORD_KINDS.length - 1);
  });

  it('is allow-listed for the migration baseline check', () => {
    const baseline = JSON.parse(readFileSync('supabase/baseline/current.json', 'utf8'));
    expect(baseline.allowedPostBaselineFiles).toContain('20261010110000_global_search_v1.sql');
  });
});
