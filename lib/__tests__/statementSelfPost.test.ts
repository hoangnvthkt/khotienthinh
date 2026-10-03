import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Bảng đối soát HĐ nguyên tắc: người chốt được tự ghi công nợ (chủ SP 03/10/2026).

const sql = readFileSync('supabase/migrations/20261008133800_procurement_statement_self_post.sql', 'utf8');

describe('Ghi công nợ bảng đối soát', () => {
  it('không còn chặn người chốt tự ghi nợ, vẫn đánh dấu selfPost', () => {
    expect(sql).not.toContain("message = 'PROCUREMENT_STATEMENT_SELF_POST'");
    expect(sql).not.toContain("confirmedBy', '') <> v_actor::text");
    expect(sql).toContain("jsonb_build_object('selfPost', true)");
    expect(sql).toContain('procurement_statement_accountant_ok(v_actor, s.project_id, s.construction_site_id))');
  });
});
