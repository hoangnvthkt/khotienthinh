import { describe, expect, it } from 'vitest';
import { buildWidgetActions, parseCenterActionFlags, type CenterActionFlags } from '../centerActions';
import { CENTER_WIDGET_GROUPS } from '../centerRegistry';
import type { CenterProject } from '../centerTodayService';
import { getRouteModuleKey, isAuthenticatedOpenRoute, normalizeRoutePath } from '../../routeAccess';

const NOW = new Date(2026, 9, 7, 8, 30);
const PROJECT: CenterProject = { id: 'smb', code: 'SMB-2026', name: 'SMB', status: 'active', endDate: null, source: 'assignment', site: null };

const ALL: CenterActionFlags = parseCenterActionFlags({
  projectId: 'smb', employee: true,
  project: { materialRequest: true, dailyLog: true, dailyReport: true, workPlan: true },
  hrm: { checkin: true, leave: true, makeup: true, timesheet: true, assignment: true },
  work: { request: true, workflow: true, po: true, task: true },
  office: { compose: true, incoming: true, booking: true, directory: true },
  supply: { hot: true, inbox: true, receive: true, count: true, warehouseId: 'wh' },
  finance: { siteFund: true, projectFinance: true, paymentRequest: true },
});
const NONE = parseCenterActionFlags({ projectId: null, employee: false, hrm: {}, work: {}, office: { booking: true } });

describe('quick actions (kế hoạch 07 mục 5)', () => {
  it('offers every approved button for every widget, each with a real destination', () => {
    for (const group of CENTER_WIDGET_GROUPS) {
      const actions = buildWidgetActions(group.id, ALL, PROJECT, NOW);
      expect(actions.length, group.id).toBeGreaterThanOrEqual(3);
      expect(actions.filter(action => action.primary).length, `${group.id} has one primary`).toBe(1);
      for (const action of actions) {
        expect(action.enabled, `${group.id}.${action.key}`).toBe(true);
        expect(action.lockReason).toBeUndefined();
        expect(action.target.title).toBeTruthy();
        if (action.target.kind === 'route') {
          const path = normalizeRoutePath(action.target.path);
          expect(Boolean(getRouteModuleKey(path)) || isAuthenticatedOpenRoute(path), `${group.id}.${action.key} → ${path}`).toBe(true);
        }
      }
    }
  });

  it('keeps the buttons visible but locked with a reason when the server says no', () => {
    const locked = CENTER_WIDGET_GROUPS.flatMap(group => buildWidgetActions(group.id, NONE, null, NOW));
    const enabled = locked.filter(action => action.enabled).map(action => action.key);
    expect(enabled).toEqual(['booking']);
    for (const action of locked.filter(action => !action.enabled)) expect(action.lockReason, action.key).toBeTruthy();
    expect(locked.find(action => action.key === 'material_request')?.lockReason).toBe('Chọn dự án trước');
    expect(locked.find(action => action.key === 'leave')?.lockReason).toContain('hồ sơ nhân viên');
  });

  it('opens real module forms: modal for leave / request, create param for Work, hub mode for hot purchase', () => {
    const by = (id: Parameters<typeof buildWidgetActions>[0], key: string) => buildWidgetActions(id, ALL, PROJECT, NOW).find(action => action.key === key)!;
    expect(by('hrm', 'leave').target).toEqual({ kind: 'modal', modal: 'leave', title: 'Xin nghỉ phép' });
    expect(by('work', 'request').target).toEqual({ kind: 'modal', modal: 'request', title: 'Tạo đề xuất' });
    expect(by('work', 'task').target).toMatchObject({ kind: 'route', path: '/work/my?create=1' });
    expect(by('supply', 'hot').target).toMatchObject({ kind: 'tab', renderer: 'procurement', props: { initialMode: 'hot' } });
    expect(by('project', 'work_plan').target).toMatchObject({ kind: 'route', path: '/da?projectId=smb&tab=work_plan&period=week&start=2026-10-05' });
    expect(by('hrm', 'makeup').target).toMatchObject({ kind: 'route', path: '/hrm/attendance?tab=proposals' });
    expect(by('finance', 'payment_request').target).toMatchObject({ kind: 'tab', renderer: 'finance', props: { initialSection: 'requests' } });
  });

  it('parses flags fail-closed', () => {
    const flags = parseCenterActionFlags({ projectId: 'x', employee: 'yes', project: { materialRequest: 'true' }, supply: 'nope' });
    expect(flags.employee).toBe(false);
    expect(flags.project?.materialRequest).toBe(false);
    expect(flags.supply).toBeNull();
    expect(flags.office.booking).toBe(false);
  });
});
