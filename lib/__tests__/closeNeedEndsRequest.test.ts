import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// "Đóng nhu cầu" ở Mua hàng tự Kết thúc đề xuất vật tư (chủ SP đồng ý 03/10/2026).

const sql = readFileSync('supabase/migrations/20261008133700_procurement_close_need_ends_request.sql', 'utf8');
const fn = (name: string) => {
  const start = sql.search(new RegExp(`FUNCTION ${name.replace('.', '\\.')}\\(`, 'i'));
  expect(start, name).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('\n$$;', start));
};

describe('Đóng nhu cầu → Kết thúc đề xuất', () => {
  it('đóng nhu cầu đề xuất vật tư thì kết thúc đề xuất; mở lại thì gỡ đúng lần đóng đó', () => {
    const close = fn('public.close_procurement_need_v1');
    expect(close).toContain("if s->>'sourceType' = 'material_request' then");
    expect(close).toContain('app_private.procurement_close_end_request(');
    expect(close).toContain('app_private.procurement_close_reopen_request(');
    const end = fn('app_private.procurement_close_end_request');
    expect(end).toContain("workflow_step = 'ended'");
    expect(end).toContain("s.line_state in ('waiting', 'none')");
    expect(end).toContain("'by', 'procurement_close'");
    const reopen = fn('app_private.procurement_close_reopen_request');
    expect(reopen).toContain("coalesce(v_last.metadata->>'by', '') <> 'procurement_close'");
    expect(reopen).toContain('closed_at = p_closed_at');
    expect(reopen).toContain('app_private.refresh_material_request_supply_v1(p_request_id)');
  });

  it('phiếu kết thúc do Mua hàng đóng vẫn ở tab "Đã đóng" để mở lại', () => {
    expect(fn('app_private.procurement_inbox_documents')).toContain("r.status = 'COMPLETED' and r.workflow_step = 'ended' and exists");
    expect(fn('app_private.procurement_inbox_lines')).toContain("'{}'::text[]");
  });
});
