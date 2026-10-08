import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261009150000_material_plan_week_to_procurement.sql'), 'utf8').toLowerCase();

describe('Chỉ KH vật tư tuần vào Mua hàng', () => {
  it('sends week plans, keeps month plans that already have orders', () => {
    expect(sql).toContain("select p_period_type = 'week'");
    expect(sql).toContain('or exists (select 1 from public.procurement_po_plan_links k where k.material_plan_id = p_plan_id)');
  });

  it('filters both the inbox documents and the inbox lines', () => {
    expect(sql).toContain("from public.project_material_plans p where p.status = 'approved' and app_private.material_plan_goes_to_procurement(p.id, p.period_type)");
    expect(sql).toContain("where p.status = 'approved' and app_private.material_plan_goes_to_procurement(p.id, p.period_type);");
  });

  it('keeps material requests in the inbox unchanged', () => {
    expect(sql).toContain('from app_private.material_request_supply_lines_v1(null) s');
    expect(sql).toContain("where r.request_origin = 'project' and (r.status in ('approved', 'in_transit')");
  });
});
