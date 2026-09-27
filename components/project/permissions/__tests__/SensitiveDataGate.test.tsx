import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SensitiveDataGate from '../SensitiveDataGate';
import { canViewSensitive, type MySensitiveScope } from '../../../../lib/projectSensitiveAccessService';

const render = (access: React.ComponentProps<typeof SensitiveDataGate>['access'], domain: 'finance' | 'contract' = 'finance') =>
  renderToStaticMarkup(<SensitiveDataGate access={access} domain={domain}><p>Số liệu thật</p></SensitiveDataGate>);

describe('SensitiveDataGate', () => {
  it('shows data only when the domain is open', () => {
    expect(render({ status: 'ready', finance: true, contract: false })).toContain('Số liệu thật');
    const locked = render({ status: 'ready', finance: true, contract: false }, 'contract');
    expect(locked).not.toContain('Số liệu thật');
    expect(locked).toContain('Chưa được mở quyền xem hợp đồng');
  });

  it('never renders data while loading or on error', () => {
    expect(render({ status: 'loading' })).toContain('Đang kiểm tra quyền xem tài chính');
    const failed = render({ status: 'error', message: 'timeout', retry: () => undefined });
    expect(failed).toContain('Không kiểm tra được quyền xem tài chính');
    expect(failed).not.toContain('Số liệu thật');
  });
});

describe('canViewSensitive', () => {
  const scope: MySensitiveScope = {
    finance: { all: false, projectIds: ['p1'], siteIds: ['s1'] },
    contract: { all: true, projectIds: [], siteIds: [] },
  };

  it('matches project, site or all-projects switches', () => {
    expect(canViewSensitive(scope, 'finance', 'p1', null)).toBe(true);
    expect(canViewSensitive(scope, 'finance', 'p2', 's1')).toBe(true);
    expect(canViewSensitive(scope, 'finance', 'p2', 's2')).toBe(false);
    expect(canViewSensitive(scope, 'contract', 'p9', null)).toBe(true);
  });
});
