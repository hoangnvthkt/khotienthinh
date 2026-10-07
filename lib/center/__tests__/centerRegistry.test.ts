import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CENTER_MODULE_KEYS, CENTER_WIDGET_GROUPS } from '../centerRegistry';
import { parseCenterAccess } from '../centerService';
import { getRouteModuleKey, isAuthenticatedOpenRoute } from '../../routeAccess';

const css = readFileSync(resolve(__dirname, '../../../components/center/center.css'), 'utf8');
const block = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));

describe('Command Center registry', () => {
  it('has one card per widget group', () => {
    expect(new Set(CENTER_WIDGET_GROUPS.map(group => group.id)).size).toBe(CENTER_WIDGET_GROUPS.length);
  });

  it.each(CENTER_WIDGET_GROUPS.map(group => [group.label, group.route]))('%s opens a guarded or open app route (%s)', (_label, route) => {
    expect(Boolean(getRouteModuleKey(route)) || isAuthenticatedOpenRoute(route)).toBe(true);
  });

  // Mọi module cùng một màu xanh thép (chủ SP 07/10); nền tối đổi --vcc-steel nên module ăn theo.
  it.each([...CENTER_MODULE_KEYS])('colours %s with the shared steel token in light and dark', key => {
    expect(block('.vcc')).toContain(`--c-${key}: var(--vcc-steel);`);
    expect(block('.vcc')).toContain(`--c-${key}-s: var(--vcc-steel-s);`);
    expect(css).toContain(`.vcc-mod-${key} {`);
  });

  it('defines the steel token for light and dark', () => {
    for (const selector of ['.vcc', '.dark .vcc']) {
      expect(block(selector)).toMatch(/--vcc-steel: #[0-9a-f]{6};/);
      expect(block(selector)).toMatch(/--vcc-steel-s: #[0-9a-f]{6};/);
    }
  });

  it('never loops an animation (WebKit rule, docs/ui/VIOO-UI-UX.md §6)', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/animation|@keyframes/);
  });
});

describe('Command Center access payload', () => {
  it('reads an enabled rollout', () => {
    expect(parseCenterAccess({ enabled: true, mode: 'read_only', expiresAt: '2026-12-31T00:00:00Z' }))
      .toEqual({ status: 'enabled', mode: 'read_only', expiresAt: '2026-12-31T00:00:00Z' });
    expect(parseCenterAccess({ enabled: true, mode: 'on' })).toEqual({ status: 'enabled', mode: 'on', expiresAt: null });
  });

  it('fails closed on anything else', () => {
    expect(parseCenterAccess({ enabled: false, mode: 'off', reason: 'not_in_rollout' })).toEqual({ status: 'off', reason: 'not_in_rollout' });
    expect(parseCenterAccess({ enabled: 'true' })).toEqual({ status: 'off', reason: 'no_permission' });
    expect(parseCenterAccess(null)).toEqual({ status: 'off', reason: 'no_permission' });
  });
});
