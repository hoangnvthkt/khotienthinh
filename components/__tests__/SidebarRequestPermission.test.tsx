import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role, type User } from '../../types';
import Sidebar from '../Sidebar';

let currentUser: User;

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({
    user: currentUser,
    users: [currentUser],
    warehouses: [],
    transactions: [],
    requests: [],
    appSettings: { name: 'VIOO', logo: '' },
    items: [],
    realtimeStatus: 'SUBSCRIBED',
    lastRealtimeEvent: null,
    connectionError: null,
  }),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ isDark: false, toggleTheme: vi.fn() }),
}));

vi.mock('../../context/ChatContext', () => ({
  useChat: () => ({ totalUnread: 0 }),
}));

vi.mock('../../hooks/useChatV2', () => ({
  useChatV2UnreadCount: () => 0,
}));

vi.mock('../NotificationCenter', () => ({ default: () => null }));
vi.mock('../XPProgress', () => ({ XPProgressBar: () => null }));
vi.mock('../OfflineIndicator', () => ({ RealtimeBadge: () => null }));

const requestTemplateManager = (): User => ({
  id: 'request-template-manager',
  name: 'Đặng Thị Hương',
  email: 'huong@example.com',
  role: Role.EMPLOYEE,
  permissionGrants: [
    'request.instance.view_own',
    'request.template.view',
    'request.template.manage',
  ].map(permissionCode => ({
    userId: 'request-template-manager',
    permissionCode,
    scopeType: 'global',
    scopeId: '*',
    isActive: true,
  })),
});

describe('Sidebar request navigation', () => {
  beforeEach(() => {
    currentUser = requestTemplateManager();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
    });
  });

  it('shows Mẫu yêu cầu to an employee with canonical template management rights', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/rq/templates">
        <Sidebar
          isOpen
          toggle={() => undefined}
          collapsed={false}
          setCollapsed={() => undefined}
        />
      </StaticRouter>,
    );

    expect(html).toContain('Mẫu yêu cầu');
    expect(html).toContain('href="/rq/templates"');
  });
});
