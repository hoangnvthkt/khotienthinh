import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role, type User } from '../../../types';
import RequestTemplates from '../RequestTemplates';

let currentUser: User;

vi.mock('../../../context/AppContext', () => ({
  useApp: () => ({ user: currentUser }),
}));
vi.mock('../../../context/ConfirmContext', () => ({ useConfirm: () => vi.fn() }));
vi.mock('../../../context/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const userWith = (...permissionCodes: string[]): User => ({
  id: 'huong-fixture',
  name: 'Đặng Thị Hương',
  email: 'huong@example.invalid',
  role: Role.EMPLOYEE,
  permissionGrants: permissionCodes.map(permissionCode => ({
    userId: 'huong-fixture',
    permissionCode,
    scopeType: 'global',
    scopeId: '*',
    isActive: true,
  })),
});

describe('Request template list authorization', () => {
  beforeEach(() => { currentUser = userWith('request.template.view'); });

  it('allows a viewer to read the list without exposing mutation controls', () => {
    const html = renderToStaticMarkup(<StaticRouter location="/rq/templates"><RequestTemplates /></StaticRouter>);
    expect(html).toContain('Mẫu yêu cầu');
    expect(html).not.toContain('Truy cập bị từ chối');
    expect(html).not.toContain('Tạo mẫu yêu cầu');
  });

  it('shows mutation controls to a template manager', () => {
    currentUser = userWith('request.template.view', 'request.template.manage');
    const html = renderToStaticMarkup(<StaticRouter location="/rq/templates"><RequestTemplates /></StaticRouter>);
    expect(html).toContain('Tạo mẫu yêu cầu');
  });
});
