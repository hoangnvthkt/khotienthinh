import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 24/10/2026 — Dự án SMB-2026: chủ SP sửa người ở bước duyệt Đề xuất vật tư rồi lưu cấu hình,
// màn hiện trần trụi "WORKFLOW_TEMPLATE_OWNED_BY_OTHER_SCOPE". Gốc: panel mở từ một công trường
// nên phạm vi mặc định là "Riêng công trường", trong khi mẫu đang dùng là BẢN RIÊNG DỰ ÁN —
// set_project_workflow_binding từ chối gắn mẫu riêng dự án vào phạm vi công trường (403).
const panel = readFileSync('components/project/ProjectWorkflowBindingPanel.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260926090000_project_owned_material_request_workflow.sql', 'utf8');

describe('Phạm vi áp dụng của bản quy trình riêng dự án', () => {
  it('máy chủ vẫn giữ luật: mẫu riêng dự án không gắn vào công trường', () => {
    expect(migration).toContain("raise exception 'WORKFLOW_TEMPLATE_OWNED_BY_OTHER_SCOPE' using errcode = '42501'");
    expect(migration).toContain('p_project_id is distinct from v_owner_project_id or p_construction_site_id is not null');
  });
  it('màn tự dùng phạm vi dự án khi mẫu đang chọn là bản riêng dự án', () => {
    expect(panel).toContain('const selectedOwnedByProject = Boolean(selectedTemplate?.ownerProjectId);');
    expect(panel).toContain("const effectiveTargetScope: 'project' | 'site' = selectedOwnedByProject ? 'project' : targetScope;");
    // Lưu và xóa cấu hình đều đi theo phạm vi đã chỉnh, không theo lựa chọn cũ.
    expect(panel.match(/constructionSiteId: effectiveTargetScope === 'site'/g)).toHaveLength(2);
    expect(panel).not.toContain("constructionSiteId: targetScope === 'site'");
  });
  it('khóa nút "Riêng công trường" và nói rõ lý do', () => {
    expect(panel).toContain("const locked = selectedOwnedByProject && option === 'site';");
    expect(panel).toContain('disabled={locked}');
    expect(panel).toContain('OWNED_SCOPE_HINT');
  });
  it('lỗi của máy chủ hiện thành câu tiếng Việt có hướng xử lý', () => {
    expect(panel).toContain('WORKFLOW_TEMPLATE_OWNED_BY_OTHER_SCOPE:');
    expect(panel).toContain('describeBindingError(err,');
    expect(panel).not.toContain("setError(err?.message || 'Không lưu được cấu hình quy trình.')");
    expect(panel).not.toContain("setError(err?.message || 'Không xóa được cấu hình riêng.')");
  });
});
