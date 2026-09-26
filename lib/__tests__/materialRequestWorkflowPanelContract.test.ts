import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('material request workflow panel contract', () => {
  const panel = read('components/project/ProjectWorkflowBindingPanel.tsx');
  const tab = read('components/project/material/MaterialRequestTab.tsx');
  const board = read('components/project/MaterialRequestKanbanBoard.tsx');

  it('keeps the panel visible for read-only users and explains why', () => {
    expect(panel).not.toContain('if (!configuration?.canManage) return null;');
    expect(panel).toContain('READ_ONLY_REASON');
    expect(panel).toContain('role="dialog"');
    expect(panel).toContain('useDialogFocusTrap');
  });

  it('shows effective template, scope and ordered steps without faking a zero count', () => {
    expect(panel).toContain('scopeLabel[scope]');
    expect(panel).toContain('describeStepAssignment');
    expect(panel).toContain('Duyệt đồng thời');
    expect(panel).toContain('validation?.taskCount');
    expect(panel).toContain('Người phụ trách tạo đợt cấp / đặt mua');
    expect(panel).toContain("scope === 'global'");
  });

  it('edits a project-owned copy instead of the shared template', () => {
    const editor = read('components/project/ProjectWorkflowStepEditor.tsx');
    expect(panel).toContain('cloneProjectTemplate');
    expect(panel).toContain('Sửa ở đây sẽ tạo bản riêng cho dự án');
    expect(panel).toContain('<ProjectWorkflowStepEditor');
    expect(panel).toContain('canCustomize');
    expect(editor).toContain('saveTemplateStructure');
    expect(editor).toContain('buildLinearTemplateStructure');
    expect(editor).toContain('listRecipients');
    expect(editor).toContain('Người phụ trách tạo đợt cấp / đặt mua');
  });

  it('drops soft-removed template steps before they become Kanban lanes', () => {
    expect(tab).toContain('__templateRemoved');
    expect(tab).toContain('templateNodes={workflowTemplateNodes}');
  });

  it('tells the user why a Kanban drop was refused', () => {
    expect(board).toContain('rejectDrop(describeRefusedDrop(request, stage, fromStage))');
    expect(board).toContain('aria-live="polite"');
    expect(board).not.toContain('if (fromStage === stage || !canMoveRequest(request, stage, fromStage)) return;');
  });
});
