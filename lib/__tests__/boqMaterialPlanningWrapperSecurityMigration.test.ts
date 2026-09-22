import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260922064202_fix_boq_material_planning_wrapper_security.sql', import.meta.url),
  'utf8',
).toLowerCase();

describe('BOQ material planning authenticated wrapper repair', () => {
  it('executes through an owner wrapper while preserving actor-bound authorization', () => {
    expect(sql).toMatch(/create or replace function public\.list_boq_material_planning_v1[\s\S]+security definer\s+set search_path = ''/);
    expect(sql).toContain('public.current_app_user_id()');
    expect(sql).toContain('app_private.list_boq_material_planning_v1');
    expect(sql).toMatch(/revoke all on function public\.list_boq_material_planning_v1[\s\S]+from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.list_boq_material_planning_v1[\s\S]+to authenticated, service_role/);
    expect(sql).not.toMatch(/grant execute on function app_private\.list_boq_material_planning_v1[\s\S]+to authenticated/);
  });
});
