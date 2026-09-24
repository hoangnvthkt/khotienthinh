import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canSubmitProjectV2Comment, projectV2ActivityLabel } from '../projectV2/collaboration';

describe('Project V2 collaboration', () => {
  it('blocks whitespace comments and comments while the plan form is dirty', () => {
    expect(canSubmitProjectV2Comment(' \n ', false)).toBe(false);
    expect(canSubmitProjectV2Comment('Xin kiểm tra', true)).toBe(false);
    expect(canSubmitProjectV2Comment('Xin kiểm tra', false)).toBe(true);
  });

  it('renders only typed server event codes, never arbitrary audit text', () => {
    expect(projectV2ActivityLabel('approved')).toBe('Đã phê duyệt');
    expect(projectV2ActivityLabel('<script>alert(1)</script>')).toBe('Hoạt động kế hoạch');
  });

  it('uses a guarded keyset page and persists server actor/time', () => {
    const sql = readFileSync('supabase/migrations/20260923165407_project_v2_collaboration_lineage.sql', 'utf8');
    expect(sql).toContain('list_project_v2_plan_collaboration_v1');
    expect(sql).toContain('project_v2_assert_permission');
    expect(sql).toContain('author_user_id');
    expect(sql).toContain('created_at');
    expect(sql).toContain('p_before_at');
    expect(sql).toContain('p_before_id');
  });
});
