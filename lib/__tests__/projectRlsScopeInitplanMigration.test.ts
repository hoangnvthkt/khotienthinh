import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261012094700_project_rls_scope_initplan.sql'),
  'utf8',
);

const policyBody = (policy: string) => {
  const start = migration.indexOf(`alter policy ${policy} `);
  expect(start, `missing policy ${policy}`).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf(');\n', start);
  return migration.slice(start, end);
};

describe('RLS dự án kiểm quyền một lần mỗi cặp (dự án, công trường)', () => {
  it.each([
    ['material_budget_items_select', 'material_planning_scope_keys'],
    ['project_work_boq_items_select', 'material_planning_scope_keys'],
    ['project_tasks_gantt_view', 'gantt_view_scope_keys'],
    ['daily_logs_select', 'daily_log_select_scope_keys'],
    ['daily_log_labor_select', 'daily_log_select_scope_keys'],
    ['daily_log_machines_select', 'daily_log_select_scope_keys'],
  ])('%s dùng InitPlan và rơi về luật cũ cho cặp chưa có trong bảng', (policy, keysFn) => {
    const body = policyBody(policy);
    // (select …)::text[] là scalar subquery → InitPlan chạy một lần mỗi câu lệnh.
    expect(body).toContain(`= any ((select app_private.${keysFn}(true))::text[])`);
    expect(body).toContain(`not (app_private.rls_scope_key(`);
    expect(body).toContain(`= any ((select app_private.${keysFn}(false))::text[])`);
  });

  it('tập cặp được tính trước rồi mới kiểm quyền (không đẩy điều kiện quyền vào từng dòng)', () => {
    const scopeFunctions = migration.match(/create or replace function app_private\.\w+_scope_keys[\s\S]*?\$\$;/g) || [];
    expect(scopeFunctions).toHaveLength(3);
    for (const fn of scopeFunctions) {
      expect(fn).toContain('with scopes as materialized (');
      expect(fn).toContain('security definer');
      expect(fn).toContain("set search_path = ''");
    }
  });

  it('khóa phạm vi phân biệt NULL với chuỗi rỗng và có thể inline', () => {
    const keyFn = migration.match(/create or replace function app_private\.rls_scope_key[\s\S]*?\$\$;/)?.[0] || '';
    expect(keyFn).toContain('immutable');
    expect(keyFn).not.toContain('security definer');
    expect(keyFn).not.toContain('set search_path');
    expect(keyFn).toContain("pg_catalog.length(p_project_id)::text || ':' || p_project_id, '-'");
  });

  it('không đổi policy ghi', () => {
    expect(migration).not.toMatch(/alter policy \w+_(insert|update|delete)\b/);
    expect(migration).not.toMatch(/drop policy/i);
  });

  it('RPC kiểm quyền theo lô gọi đúng hàm kiểm từng quyền và chỉ cấp cho authenticated', () => {
    expect(migration).toContain('app_private.project_has_permission_v2(p_project_id, p_construction_site_id, codes.code, p_user_id)');
    expect(migration).toContain('revoke all on function public.project_has_permissions_v2(text, text, text[], uuid) from public, anon;');
  });
});
