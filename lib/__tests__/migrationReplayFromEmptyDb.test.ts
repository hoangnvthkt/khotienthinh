import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Supabase Preview dựng DB trống rồi chạy lại mọi migration theo tên file. Migration ghi dữ liệu prod
// phải bỏ qua khi dòng gốc không có, và file chạy trước bảng nó dùng phải tắt kiểm thân hàm.
const read = (file: string) => readFileSync(path.resolve(__dirname, '../../supabase/migrations', file), 'utf8');

describe('migrations replay on an empty database (Supabase Preview)', () => {
  it('seeds the internal partner only when that business partner exists', () => {
    const sql = read('20261006090000_finance_k3a_payables.sql');
    expect(sql).toMatch(/insert into public\.finance_internal_partners \(supplier_id, reason\)\s+select bp\.id,/);
    expect(sql).toContain("where bp.id = '5ecf36bb-ab2c-42fc-874b-4950859a91d7'");
  });

  it('seeds cost cutovers only for projects that exist', () => {
    const sql = read('20261006150000_finance_k3a2_cost_cutover_stock.sql');
    expect(sql).toContain('where exists (select 1 from public.projects p where p.id::text = v.project_id)');
    expect(sql).not.toMatch(/insert into public\.finance_project_cost_cutovers \(project_id, cutover_date, note\) values/);
  });

  it('creates allocation functions before the H4 timesheet tables exist', () => {
    const sql = read('20261008134400_finance_allocation_site_fund.sql');
    expect(sql.indexOf('set check_function_bodies = off;')).toBeGreaterThan(-1);
    expect(sql.indexOf('set check_function_bodies = off;'))
      .toBeLessThan(sql.indexOf('create function app_private.finance_allocation_build'));
    expect(sql.trimEnd().endsWith('reset check_function_bodies;')).toBe(true);
  });
});
