import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HrmAuthorizationPanelView } from '../HrmAuthorizationPanel';

describe('HrmAuthorizationPanelView', () => {
  it('shows the four governed authorization views and derived manager status', () => {
    const html = renderToStaticMarkup(
      <HrmAuthorizationPanelView
        currentUserId="admin-1"
        targetUserId="manager-1"
        summary={{
          targetUserId: 'manager-1',
          systemRole: 'EMPLOYEE',
          employeeCode: 'NV001',
          isDirectManager: true,
          directReportCount: 4,
          hrRole: 'HR',
          fingerprint: 'fingerprint-1',
          effectivePermissions: [],
          history: [],
        }}
        selectedRole="HR"
        expiresAt=""
        reason=""
        preview={null}
        activeTab="overview"
        isLoading={false}
        isApplying={false}
        error={null}
        onTabChange={vi.fn()}
        onRoleChange={vi.fn()}
        onExpiresAtChange={vi.fn()}
        onReasonChange={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(html).toContain('Tổng quan');
    expect(html).toContain('Vai trò nghiệp vụ');
    expect(html).toContain('Quyền hiệu lực');
    expect(html).toContain('Lịch sử');
    expect(html).toContain('Quản lý trực tiếp');
    expect(html).toContain('4 nhân sự');
  });

  it('shows the dedicated self-grant action for a technical admin', () => {
    const html = renderToStaticMarkup(
      <HrmAuthorizationPanelView
        currentUserId="admin-1"
        targetUserId="admin-1"
        summary={{
          targetUserId: 'admin-1',
          systemRole: 'ADMIN',
          isDirectManager: false,
          directReportCount: 0,
          hrRole: null,
          fingerprint: 'fingerprint-1',
          effectivePermissions: [],
          history: [],
        }}
        selectedRole="NONE"
        expiresAt=""
        reason=""
        preview={null}
        activeTab="business_role"
        isLoading={false}
        isApplying={false}
        error={null}
        onTabChange={vi.fn()}
        onRoleChange={vi.fn()}
        onExpiresAtChange={vi.fn()}
        onReasonChange={vi.fn()}
        onPreview={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(html).toContain('Cấp HR Manage cho tôi');
  });
});
