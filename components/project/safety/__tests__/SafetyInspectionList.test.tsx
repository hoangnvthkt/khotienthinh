import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SafetyInspection } from '../../../../types';
import SafetyInspectionList from '../SafetyInspectionList';

const inspection: SafetyInspection = {
  id: 'inspection-1',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  code: 'AT-001',
  inspectionDate: '2026-09-18',
  area: 'Khu vực cẩu nâng',
  inspectorUserId: 'user-1',
  inspectorName: 'Cán bộ an toàn',
  status: 'in_progress',
  score: null,
  summary: null,
  attachments: [],
  createdBy: 'user-1',
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z',
};

const renderList = (canDelete: boolean) => renderToStaticMarkup(
  <SafetyInspectionList
    inspections={[inspection]}
    getItems={async () => []}
    onUpdateItem={async () => undefined}
    onComplete={async () => undefined}
    onGenerateIssue={async () => undefined}
    onCreate={() => undefined}
    onEdit={() => undefined}
    onDelete={() => undefined}
    canManage
    canDelete={canDelete}
  />,
);

describe('SafetyInspectionList permissions', () => {
  it('lets an editor create and edit inspections without exposing delete', () => {
    const markup = renderList(false);

    expect(markup).toContain('Tạo kiểm tra hiện trường');
    expect(markup).toContain('title="Sửa"');
    expect(markup).not.toContain('title="Xóa"');
  });

  it('shows delete only when the safety delete action is granted', () => {
    expect(renderList(true)).toContain('title="Xóa"');
  });
});
