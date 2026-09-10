import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const userModal = read('components/UserModal.tsx');
const editor = read('components/permissions/AuthorizationEditor.tsx');
const legacy = read('components/permissions/LegacyPermissionReadOnly.tsx');
const matrix = read('components/permissions/PermissionMatrix.tsx');

describe('unified authorization editor UI contract', () => {
  it('removes both legacy editors and saves edits through the atomic V2 command', () => {
    expect(userModal).not.toContain('Phân quyền module');
    expect(userModal).not.toContain('Quản trị Sub-module');
    expect(userModal).not.toContain('replaceUserPermissionGrants');
    expect(userModal).toContain('updateUserAuthorizationV2');
    expect(userModal).toContain('<AuthorizationEditor');
    expect(userModal).not.toMatch(/setFormData\([^)]*(allowedModules|allowedSubModules|adminModules|adminSubModules)/s);
  });

  it('presents module shell, scoped capabilities and Project Room status in one editor', () => {
    expect(editor).toContain('Quyền truy cập module');
    expect(editor).toContain('Năng lực theo phạm vi');
    expect(editor).toContain('Phân quyền Room dự án');
    expect(editor).toContain('PermissionScopePicker');
    expect(editor).toContain('PermissionMatrix');
    expect(editor).toContain('PermissionDiffPreview');
  });

  it('keeps legacy state read-only with provenance, collision and migration status', () => {
    expect(legacy).toContain('Dữ liệu legacy — chỉ đọc');
    expect(legacy).toContain('Nguồn');
    expect(legacy).toContain('Xung đột');
    expect(legacy).toContain('Trạng thái chuyển đổi');
    expect(legacy).not.toContain('type="checkbox"');
  });

  it('copies direct grants with scopes and does not copy identity or legacy fields', () => {
    expect(editor).toContain('directGrants');
    expect(editor).toContain('scopeType');
    expect(editor).toContain('scopeId');
    expect(editor).not.toContain('allowedModules');
    expect(editor).not.toContain('adminModules');
    expect(editor).not.toMatch(/\brole\s*:/);
  });

  it('requires a reason and renders inherited authority as a non-editable badge', () => {
    expect(editor).toContain('Lý do thay đổi');
    expect(editor).toContain('required');
    expect(matrix).toContain('Kế thừa');
    expect(matrix).toContain('inherited && !explicit');
  });
});
