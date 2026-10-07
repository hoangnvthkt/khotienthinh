import { describe, expect, it } from 'vitest';
import {
  applyCenterLayout, defaultCenterLayout, fullOrder, hideWidget, moveWidget, parseCenterLayout, sameLayout, showWidget, type CenterLayout,
} from '../centerLayout';
import { parseCenterActionFlags } from '../centerActions';
import { parseCenterToday } from '../centerTodayService';
import type { WidgetView } from '../todayWidgets';

const views = (['project', 'hrm', 'work', 'office', 'supply', 'finance'] as const).map(id => ({ id, module: 'project', title: id, sub: '', stats: [], route: '/', routeLabel: '' }) as WidgetView);
const withProject = parseCenterToday({ project: { id: 'p', code: 'P', name: 'P' }, widgets: {} });
const noProject = parseCenterToday({ project: null, widgets: {} });

describe('Center layout', () => {
  it('parses saved layouts fail-closed and treats empty as "use default"', () => {
    expect(parseCenterLayout({ widgets: { order: ['hrm', 'bogus', 'hrm', 'project'], hidden: ['office', 3] } }))
      .toEqual({ widgets: { order: ['hrm', 'project'], hidden: ['office'] } });
    expect(parseCenterLayout({ widgets: { order: [], hidden: [] } })).toBeNull();
    expect(parseCenterLayout({})).toBeNull();
    expect(parseCenterLayout('x')).toBeNull();
  });

  it('defaults by what the server says the person does', () => {
    const accountant = parseCenterActionFlags({ finance: { paymentRequest: true }, supply: { inbox: true } });
    const buyer = parseCenterActionFlags({ supply: { inbox: true } });
    expect(fullOrder(defaultCenterLayout(accountant, withProject))[0]).toBe('finance');
    expect(fullOrder(defaultCenterLayout(buyer, withProject))[0]).toBe('supply');
    expect(fullOrder(defaultCenterLayout(null, withProject))[0]).toBe('project');
    expect(defaultCenterLayout(null, noProject).widgets).toEqual({ order: ['hrm', 'work', 'office', 'project', 'supply', 'finance'], hidden: ['project', 'supply', 'finance'] });
  });

  it('moves, hides and restores without losing widgets', () => {
    let layout: CenterLayout = { widgets: { order: ['project'], hidden: [] } };
    expect(fullOrder(layout)).toEqual(['project', 'hrm', 'work', 'office', 'supply', 'finance']);
    layout = moveWidget(layout, 'project', 1);
    expect(fullOrder(layout).slice(0, 2)).toEqual(['hrm', 'project']);
    expect(moveWidget(layout, 'hrm', -1)).toBe(layout);
    layout = hideWidget(layout, 'office');
    const applied = applyCenterLayout(views, layout);
    expect(applied.visible.map(v => v.id)).toEqual(['hrm', 'project', 'work', 'supply', 'finance']);
    expect(applied.hidden.map(v => v.id)).toEqual(['office']);
    layout = showWidget(layout, 'office');
    expect(applyCenterLayout(views, layout).hidden).toEqual([]);
    expect(sameLayout(layout, { widgets: { order: ['hrm', 'project', 'work', 'office', 'supply', 'finance'], hidden: [] } })).toBe(true);
  });

  it('only hides widgets the page actually has (finance hidden by the server stays absent)', () => {
    const applied = applyCenterLayout(views.filter(v => v.id !== 'finance'), { widgets: { order: ['finance', 'hrm'], hidden: ['finance'] } });
    expect(applied.visible.map(v => v.id)).toEqual(['hrm', 'project', 'work', 'office', 'supply']);
    expect(applied.hidden).toEqual([]);
  });
});
